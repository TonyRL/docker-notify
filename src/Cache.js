const fs = require('fs/promises');

const cachePath = './cache/cache.json';

class Cache {
    static async getCache() {
        try {
            const data = await fs.readFile(cachePath, 'utf8');
            const cache = JSON.parse(data);
            return cache;
        } catch (err) {
            if (err.code == 'ENOENT') {
                // cache does not exist, create it
                await fs.writeFile(cachePath, '{}', 'utf8');
                return {};
            } else {
                console.log(err);
                return {};
            }
        }
    }

    static async writeCache(cache) {
        try {
            await fs.writeFile(cachePath, cache, 'utf8');
        } catch (err) {
            console.log(err);
        }
    }
}

module.exports = Cache;
