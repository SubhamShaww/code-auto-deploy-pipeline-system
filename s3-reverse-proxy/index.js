const express = require("express")
const httpProxy = require('http-proxy')

const app = express()
const PORT = 8000

const BASE_PATH = 'https://vercel-clone-outputs.s3.ap-south-1.amazonaws.com/__outputs'

const client = createClient({
    host: 'clickhouse-host-url',
    database: 'default',
    username: 'username',
    password: 'password'
})

const proxy = httpProxy.createProxy()

app.use(async (req, res) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0]

    // Custom Domain - clickhouse DB Query using subdomain to get the deployment_id
    const logs = await client.query({
        query: `SELECT event_id, deployment_id, log, timestamp from log_events WHERE subdomain={subdomain:String}`,
        query_params: {
            subdomain: subdomain
        },
        format: 'JSONEachRow'
    })
    const rawLogs = await logs.json()
    const { deployment_id } = rawLogs[0]

    const resolvesTo = `${BASE_PATH}/${deployment_id}`

    proxy.web(req, res, { target: resolvesTo, changeOrigin: true })
})

proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url;
    if (url === "/") {
        proxyReq.path += 'index.html'
    }
})

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`))
