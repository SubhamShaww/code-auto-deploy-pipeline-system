const express = require("express")
const { generateSlug } = require('random-word-slugs')
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
const cors = require('cors')
const { z } = require('zod')
const { PrismaClient } = require("@prisma/client")
const { createClient } = require("@clickhouse/client")
const { Kafka } = require('kafkajs')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 9000

const prisma = new PrismaClient({})

const kafka = new Kafka({
    clientId: `docker-build-server-${PROJECT_ID}`,
    brokers: ['broker-url'],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, "kafka.pem"), "utf-8")]
    },
    sasl: {
        username: 'username',
        password: 'password',
        mechanism: 'plain'
    }
})

const client = createClient({
    host: 'clickhouse-host-url',
    database: 'default',
    username: 'username',
    password: 'password'
})

const consumer = kafka.consumer({ groupId: 'api-server-logs-consumer' })

const ecsClient = new ECSClient({
    credentials: {
        accessKeyId: '',
        secretAccessKey: ''
    }
})

const config = {
    CLUSTER: "",
    TASK: ""
}

app.use(express.json())
app.use(cors())

app.post('/project', async (req, res) => {
    const schema = z.object({
        name: z.string(),
        gitURL: z.string()
    })
    const safeParseResult = schema.safeParse(req.body)

    if (safeParseResult) return res.status(400).json({ error: safeParseResult.error })

    const { name, gitURL } = safeParseResult.data

    const deployment = prisma.project.create({
        data: {
            name,
            gitURL,
            subDomain: generateSlug()
        }
    })

    return res.json({ status: 'success', data: { project } })
})

app.post('/deploy', async (req, res) => {
    const { projectId } = req.body;

    const project = await prisma.project.findUnique({ where: { id: projectId } })

    if (!project) return res.status(404).json({ error: 'Project not found' })

    // check if there is no running deployment
    const deployment = prisma.deployment.create({
        data: {
            project: { connect: { id: projectId } },
            status: "QUEUED"
        }
    })

    // spin the container
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: ['', ''],
                securityGroups: ['']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'builder-image',
                    environment: [
                        { name: 'GIT_REPOSITORY_URL', value: project.gitURL },
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYMENT_ID', value: deployment.id }
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command)

    return res.json({ status: 'queued', data: { projectSlug, url: `http://${projectSlug}.localhost:8000` } })
})

app.get('/logs/:id', async (req, res) => {
    const id = req.params.id
    const logs = await client.query({
        query: `SELECT event_id, deployment_id, log, timestamp from log_events WHERE deployment_id={deployment_id:String}`,
        query_params: {
            deployment_id: id
        },
        format: 'JSONEachRow'
    })
    const rawLogs = await logs.json()
    return res.json({ logs: rawLogs })
})

async function initKafkaConsumer() {
    await consumer.connect()
    await consumer.subscribe({ topics: ['container-logs'] })

    await consumer.run({
        autoCommit: false,
        eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {
            const messages = batch.messages
            console.log(`Recv. ${messages.length} messages..`)
            for (const message of messages) {
                const stringMessage = message.value.toString()
                const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage)
                try {
                    const { query_id } = await client.insert({
                        table: 'log_events',
                        values: [{ event_id: uuidv4(), deployment_id: DEPLOYMENT_ID, log }]
                    })
                    console.log(query_id)
                    resolveOffset(message.offset)
                    await commitOffsetsIfNecessary(message.offset)
                    await heartbeat()
                } catch (err) {
                    console.log(err)
                }
            }
        }
    })
}

initKafkaConsumer()

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))