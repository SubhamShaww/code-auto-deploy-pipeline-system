const express = require("express")
const { generateSlug } = require('random-word-slugs')
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')

const app = express()
const PORT = 9000

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

app.post('/project', async (req, res) => {
    const { gitURL } = req.body;
    const projectSlug = generateSlug()

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
                        { name: 'GIT_REPOSITORY_URL', value: gitURL },
                        { name: 'PROJECT_ID', value: projectSlug }
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command)

    return res.json({status: 'queued', data: {projectSlug, url: `http://${projectSlug}.localhost:8000`}})
})

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))