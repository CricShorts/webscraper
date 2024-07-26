var defaults = require("../config/scraper");
var config = require("../config/files");
var _ = require("lodash");
var Promise = require("bluebird");
var url = require("url");
var fs = Promise.promisifyAll(require("fs"));
var path = require("path");
var scrapeWebsite = require("website-scraper");
var format = require("string-template");

const createReadStream = require("fs").createReadStream;
const createWriteStream = require("fs").createWriteStream;
const process = require("process");
const { google } = require("googleapis");
require("dotenv").config();

let Archiver = require("archiver");

const pkey = {
    client_email: process.env.GDRIVE_CLIENT_EMAIL,
    // private_key: process.env.GDRIVE_PRIVATE_KEY,
    private_key: JSON.parse(
        JSON.stringify(Buffer.from(process.env.GDRIVE_PRIVATE_KEY, "base64").toString().replace(/\\n/g,"\\n"))
      )
};

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

function getSiteDirname(siteUrl) {
    var urlObj = url.parse(siteUrl);
    var domain = urlObj.host;
    return domain + "-" + new Date().getTime();
}

function getSiteFullPath(siteDirname, files = false) {
    if (files){
        return path.resolve(config.directory, siteDirname);
    } else {
        return path.resolve(config.folderDirectory, siteDirname);
    }
    
}

function getSitesDirectories() {
    var root = config.folderDirectory;
    var directories = [];
    return fs
        .readdirAsync(root)
        .then(function (files) {
            return Promise.map(files, function (file) {
                return fs.statAsync(root + "/" + file).then(function (stat) {
                    if (stat.isDirectory()) {
                        directories.push(file);
                    }
                });
            }).then(function () {
                return Promise.resolve(directories);
            });
        })
        .catch(function (err) {
            console.error("Error reading directory:", err);

            const filesDir = path.join(config.publicPath, "files");

            fs.mkdir(filesDir, { recursive: true }, (err) => {
                if (err) {
                    return console.error(err);
                }
                console.log("files created successfully!");
            });

            fs.mkdir(path.join(config.publicPath, "folders"), { recursive: true }, (err) => {
                if (err) {
                    return console.error(err);
                }
                console.log("folders created successfully!");
            });

            return;
        });
}

function buildSiteObject(directory) {
    return {
        status: true,
        directory: directory,
        previewPath: format(config.previewPath, { directory: directory }),
        downloadPath: format(config.downloadPath, { directory: directory }),
    };
}

function getNotFoundError(directory) {
    return {
        errors: {
            directory: "Site " + directory + " was not found",
        },
    };
}

function scrapeBlocked(res, result) {
    if (result && result.length && result[0].type) {
        return res.status(500).json({
            status: false,
            message:
                "Something went wrong. But you can still find the partially downloaded project files under list menu.",
        });
    } else {
        return res.status(500).json({
            status: false,
            message: "Something went wrong. Try again later.",
        });
    }
}

/**
 * Authorize with service account and get jwt client
 *
 */
async function authorize() {
    const jwtClient = new google.auth.JWT(
        pkey.client_email,
        null,
        pkey.private_key,
        SCOPES
    );
    await jwtClient.authorize();

    return jwtClient;
}

/**
 * Create a new file on google drive.
 * @param {OAuth2Client} authClient An authorized OAuth2 client.
 */
async function uploadFile(authClient, siteFullPath, siteDirname) {
    const drive = google.drive({ version: "v3", auth: authClient });

    let root = config.directory;

    let zip = Archiver("zip");
    let output = createWriteStream(`${siteFullPath}.zip`);
    zip.pipe(output);
    zip.directory(siteFullPath, false).finalize();

    const fileMetadata = {
        name: path.basename(`${siteDirname}.zip`),
        parents: [process.env.GDRIVE_FOLDER_ID],
    };

    setTimeout(async () => {
        const file = await drive.files.create({
            media: {
                body: createReadStream(`${siteFullPath}.zip`),
            },
            requestBody: fileMetadata,
        });

        if (file) {
            fs.statAsync(root + "/" + `${siteDirname}.zip`)
                .then(function (stat) {
                    if (stat.isFile()) {
                        fs.unlink(root + "/" + `${siteDirname}.zip`, (err) => {
                            if (err) {
                                console.error("Could not delete file", err);
                                return;
                            }
                            console.log("File deleted successfully");
                        });
                        fs.rmSync(siteFullPath, {recursive: true, force: true})
                    }
                })
                .catch((err) => {
                    console.log("File do not exist", err);
                    return;
                });
        }

        // const resss = await drive.files.list();
        // console.log("file zzzzzzzzzzz", file, siteDirname, resss);
        // resss.data.files.map((item) => {
        //     console.log("itt", item);
        // });

        // let dest = createWriteStream('/home/tarun/Desktop/42works/website-scaper/demo (copy)/public/files/abc.zip');
        // await drive.files.get(
        //     { fileId: '1YadzNFbihpxAl1Iovrkxv9Bqi8jkLK6W', alt: "media" },
        //     { responseType: "stream" },
        //     (err, { data }) => {
        //       if (err) {
        //         console.log(err);
        //         return;
        //       }
        //       data
        //         .on("end", () => console.log("Done."))
        //         .on("error", (err) => {
        //           console.log(err);
        //           return process.exit();
        //         })
        //         .pipe(dest);
        //     }
        //   );

        // await drive.permissions.create({
        //     fileId: '1Dt4y35D_pxUUxzC3Dh4xHhoVE4a8jY6O',
        //     transferOwnership: true,
        //     requestBody: {
        //         role: "owner",
        //         emailAddress: 'blushark-automation@bsd-page-speed.iam.gserviceaccount.com',
        //         type: "user",
        //     }
        // })

        // const delRes = await drive.files.delete({
        //     fileId: '1gJZlgPesCVNxqvLLgO1Di2dEyH2os4sp',
        // });

        // console.log("delRes", delRes)
    }, 2000);
}

var service = {
    scrape: function scrape(options, req, res) {
        var siteDirname = getSiteDirname(options.url);
        var siteFullPath = getSiteFullPath(siteDirname, true);

        var scraperOptions = _.extend({}, defaults, {
            urls: [options.url],
            directory: siteFullPath,
            // If defaults object has request property, it will be superseded by options.request
            urlFilter: (url) => url.startsWith(options.url), // Filter links to other websites
            recursive: true,
            maxRecursiveDepth: 10,
            request: options.request,
            ignoreErrors: true,
            // requestConcurrency: 5
        });

        scrapeWebsite(scraperOptions).then(function (result) {
            if (result && result.length && result[0].type) {
                console.log("scrape is done 1");
                // return Promise.resolve(buildSiteObject(siteDirname));

                let newPath = path.resolve(config.folderDirectory, siteDirname)

                fs.cpAsync(siteFullPath, newPath, {recursive: true})
                    .then(function (result) {
                        console.log("files copied", result);
                        authorize()
                        .then((authClient) => {
                            console.log(
                                "jwtclient123",
                                // authClient,
                                // siteFullPath,
                                // siteDirname
                            );
                            uploadFile(authClient, siteFullPath, siteDirname);
                        })
                        .catch(console.error);
                    })
                    .catch((err) => {
                        console.log("colud not copy", err);
                        return;
                    });

                
            } else {
                console.log("scrape is fail 2");
                // return Promise.reject(scrapeBlocked(res, result));
            }
        });

        return res.status(200).json({
            status: true,
            message:
                "This task is running in background. Please check the list page after few minutes.",
        });
    },

    list: function list() {
        return getSitesDirectories().then(function (directories) {
            if (!directories) {
                directories = [];
            }
            
            // authorize()
            // .then(async (authClient) => {
            //     const drive = google.drive({ version: "v3", auth: authClient });
            //     console.log(
            //         "jwtclient123",
            //     );
            //     const resss = await drive.files.list({
            //         fields: 'files/createdTime, files/id'
            //     });
            //     console.log("file z", resss.data);
            // })
            // .catch(console.error);
            // let a = Buffer.from(process.env.GDRIVE_PRIVATE_KEY).toString('base64');

            console.log("base 64 decoded", pkey.private_key
            // //     JSON.parse(
            // //     JSON.stringify(Buffer.from(a, "base64").toString().replace(/\\n/g,"\\n"))
            // //   )
            )

            let list = directories.map(buildSiteObject);
            let driveLink = `https://drive.google.com/drive/folders/${process.env.GDRIVE_FOLDER_ID}`;
            return Promise.resolve({list, driveLink});
        });
    },

    find: function find(dirname) {
        return getSitesDirectories().then(function (directories) {
            var found = _.find(directories, function (el) {
                return el === dirname;
            });

            if (!found) {
                return Promise.reject(getNotFoundError(dirname));
            }

            return Promise.resolve(buildSiteObject(found));
        });
    },

    getFullPath: function getFullPath(dirname) {
        return getSitesDirectories().then(function (directories) {
            var exists = directories.indexOf(dirname) > -1;

            if (!exists) {
                return Promise.reject(getNotFoundError(dirname));
            }

            return Promise.resolve(getSiteFullPath(dirname));
        });
    },
};

module.exports = service;
