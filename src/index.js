const dockerAPI = new (require('./DockerAPI').DockerAPI)();
const { mailService } = require('./mailService');
const Cache = require('./Cache');
const schema = require('./schema.json');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, useDefaults: true });
const axios = require('axios');
addFormats(ajv, ['email', 'hostname', 'uri']);

// Set up a minimal logger
const dateFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'long',
    hour12: false,
};

const dateFormatter = new Intl.DateTimeFormat('en-US', dateFormatOptions);

const logger = {
    log: function () {
        const args = Array.prototype.slice.call(arguments);
        args.unshift(dateFormatter.format(Date.now()) + ': ');
        console.log.apply(console, args);
    },
    error: function () {
        const args = Array.prototype.slice.call(arguments);
        args.unshift(dateFormatter.format(Date.now()) + ': ');
        console.error.apply(console, args);
    },
};

// Load config file
let config;

try {
    config = require('./config.json');
} catch (e) {
    logger.error('Config file error, exiting');
    logger.error(e.message);
    process.exit(1);
}

// Validate config file with schema validator
const validate = ajv.compile(schema);
const valid = validate(config);
if (!valid) {
    logger.error(validate.errors);
    process.exit(2);
}

// Prepare variables
const notifyServices = config.notifyServices;

// Validate things, that can currently not be validated by json schema
// these things are: smtp-server referenced in notifyJob is existing and
// webhooks referenced in notifyJob is existing
if (!notifyServices.every((service) => service.actions.every((action) => (action.type === 'webHook' ? config.webHooks[action.instance] : action.type === 'mailHook' ? config.smtpServer[action.instance] : false)))) {
    logger.error('Mail/Smtp Hooks that are referenced are not defined!');
    process.exit(3);
}

config.notifyServices.forEach((service) => {
    const imageParts = service.image.split('/');
    const imageName = imageParts.at(-1);
    const imageTag = imageName.split(':')?.[1] ?? 'latest';
    const imageNameWithoutTag = imageName.split(':')[0];
    const user = imageParts.length > 1 ? imageParts[0] : 'library';

    service.image = {
        user,
        name: imageNameWithoutTag,
        tag: imageTag,
    };
});

const mailtransporterMap = new Map();

const mailHookSend = async (smtpserver, recipient, updatedString, msg) => {
    if (!mailtransporterMap.has(smtpserver)) {
        mailtransporterMap.set(smtpserver, mailService(config.smtpServer[smtpserver].host, config.smtpServer[smtpserver].port, config.smtpServer[smtpserver].secure, config.smtpServer[smtpserver].username, config.smtpServer[smtpserver].password));
    }

    await sendMail(msg, mailtransporterMap.get(smtpserver), config.smtpServer[smtpserver].sendername, config.smtpServer[smtpserver].senderadress, recipient, updatedString);
};

// sends an email with a given message to the receiver which is defined in the env
const sendMail = async (msg, mailTransporter, smtpSenderName, smtpSenderAddress, mailReceiver, updatedString) => {
    try {
        await mailTransporter.verify();

        const mailOptions = {
            from: `"${smtpSenderName}" <${smtpSenderAddress}>`,
            to: mailReceiver,
            subject: `Docker image "${updatedString}" updated`,
            text: msg,
        };

        const info = await mailTransporter.sendMail(mailOptions);
        logger.log(`Notification mail sent to ${info}`);
    } catch (err) {
        logger.error(`Error while sending mail: ${err}`);
    }
};

const getRepositoryInfo = (user, name, token) => dockerAPI.repository(user, name, token);

const getTagInfo = (user, name, token) => dockerAPI.tags(user, name, token);

const checkRepository = async (job, repoCache, token) => {
    const checkUpdateDates = (repoInfo, tag) => {
        if (!repoInfo) {
            logger.error('Repository not found: ', repository.name);
            return;
        }

        let updated;
        if (repoCache) {
            const cachedDate = Date.parse(repoCache.lastUpdated);
            const currentDate = Date.parse(repoInfo.last_updated);
            updated = cachedDate < currentDate;
        } else {
            updated = false;
        }
        return {
            lastUpdated: repoInfo.last_updated,
            name: repoInfo.name,
            user: repoInfo.user,
            tag: tag ? tag : null,
            updated: updated,
            job: job,
        };
    };

    const repository = job.image;

    try {
        if (repository.tag) {
            const tags = await getTagInfo(repository.user, repository.name, token);
            const tagInfo = tags.filter((elem) => elem.name == repository.tag)[0];

            if (tagInfo == undefined) {
                logger.error('Cannot find tag for repository: ', repository.name);
                return;
            }

            tagInfo.user = repository.user;
            tagInfo.name = repository.name;
            return checkUpdateDates(tagInfo, repository.tag);
        } else {
            const repoInfo = await getRepositoryInfo(repository.user, repository.name, token);
            return checkUpdateDates(repoInfo);
        }
    } catch (err) {
        logger.error(`Error while fetching repo info: ${err}`);
        return;
    }
};

const checkForUpdates = async () => {
    try {
        const dockerHubToken = config.dockerHubUsername && config.dockerHubPassword ? await dockerAPI.token(config.dockerHubUsername, config.dockerHubPassword) : null;
        const cache = await Cache.getCache();
        const repoChecks = notifyServices.map((job) => {
            let key = job.image.user + '/' + job.image.name;
            if (job.image.tag) {
                key += ':' + job.image.tag;
            }
            logger.log('Checking: ', key);
            return checkRepository(job, cache[key], dockerHubToken);
        });
        const checkResult = await Promise.all(repoChecks);

        const newCache = {};
        const updatedRepos = [];
        for (const res of checkResult) {
            let key = res.user + '/' + res.name;
            const cacheObj = {
                user: res.user,
                name: res.name,
                lastUpdated: res.lastUpdated,
            };
            if (res.tag) {
                key += ':' + res.tag;
                cacheObj.tag = res.tag;
            }
            newCache[key] = cacheObj;
            if (res.updated) {
                let updatedString = res.user === 'library' ? res.name : res.user + '/' + res.name;
                if (res.tag) {
                    updatedString += ':' + res.tag;
                }
                updatedRepos.push({
                    job: res.job,
                    updatedString: updatedString,
                });
            }
        }

        await Cache.writeCache(JSON.stringify(newCache));
        if (updatedRepos.length > 0) {
            updatedRepos.forEach((repo) => {
                repo.job.actions.forEach(async (action) => {
                    if (action.type == 'webHook') {
                        const webHook = config.webHooks[action.instance];
                        const message = webHook.httpBody;
                        Object.keys(message).forEach((key) => {
                            if (typeof message[key] == 'string') {
                                message[key] = message[key].replace('$msg', `Docker image '${repo.updatedString}' was updated:\nhttps://hub.docker.com/r/${repo.updatedString.split(':')[0]}/tags`);
                            }
                        });

                        try {
                            const response = await axios({
                                method: webHook.httpMethod,
                                url: webHook.reqUrl,
                                headers: webHook.httpHeaders,
                                data: webHook.httpBody,
                            });
                            logger.log(`WebHook Action for image [${JSON.stringify(repo.job.image)}] successfully. Response: ${response.data}`);
                        } catch (error) {
                            logger.error(`WebHook Action for image [${JSON.stringify(repo.job.image)}] failed`);
                            logger.log(error);
                        }
                    } else if (action.type == 'mailHook') {
                        await mailHookSend(action.instance, action.recipient, repo.updatedString, `Docker image '${repo.updatedString}' was updated:\nhttps://hub.docker.com/r/${repo.updatedString.split(':')[0]}/tags`);
                    } else {
                        logger.error(`Trying to execute an unknown hook(${action.type}), falling back to printing to console`);
                        logger.error(`Image: ${JSON.stringify(repo.job.image)}`);
                    }
                });
            });
        }
    } catch (error) {
        logger.error(error);
    }
};

const checkInterval = Number(config.checkInterval);

checkForUpdates();

setInterval(checkForUpdates, 1000 * 60 * (checkInterval || 60));
