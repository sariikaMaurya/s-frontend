const { createApp } = require('./server');

async function checkAtlas() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is not configured in the loaded environment.');
    }
    const app = await createApp();
    try {
        console.log(`Portfolio connected to MongoDB database "${process.env.MONGODB_DB || 'portfolio'}"; startup import completed.`);
    } finally {
        await app.locals._dataStore.close();
    }
}

checkAtlas().catch(error => {
    const code = error.code || error.cause?.code || 'connection-or-startup-error';
    console.error(`MongoDB startup check failed (${code}). Check Atlas URI, database user/password, and Network Access IP allowlist.`);
    process.exitCode = 1;
});
