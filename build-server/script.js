const { exec } = require("child_process")
const path = require('path')
const fs = require('fs')
const { S3Client, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3")
const mime = require("mime-types")

const s3Client = new S3Client({
    region: '',
    credentials: {
        accessKeyId: '',
        secretAccessKey: ''
    }
})

const PROJECT_ID = process.env.PROJECT_ID

async function init() {
    console.log("Executing script.js")
    const outDirPath = path.join(__dirname, 'output')

    const p = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout.on("data", function (data) {
        console.log(data.toString())
    })

    p.stdout.on("error", function (data) {
        console.log('Error', data.toString())
    })

    p.on("close", async function () {
        console.log("Build Complete")
        const distFolderPath = path.join(__dirname, 'output', 'dist')
        const distFolderContents = fs.readdirsync(distFolderPath, {recursive: true})

        for (const filePath of distFolderContents) {
            if (fs.lstatSync(filePath)) continue;

            console.log('uploading', filePath)

            const command = new PutObjectCommand({
                Bucket: '',
                Key: `__outputs/${PROJECT_ID}/${filePath}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath)
            })

            await s3Client.send(command)

            console.log('uploaded', filePath)
        }

        console.log("Done...")
    })
}

init()