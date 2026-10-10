const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns');
const { collections, validateContent } = require('./content-store');

async function readLegacyList(dataDir, name) {
    try {
        const data = JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), 'utf8'));
        if (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
            throw new Error(`Invalid ${name}.json: expected a list of records.`);
        }
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

function publicRecord(record) {
    const { _id, _order, ...item } = record;
    return { ...item, id: String(_id) };
}

async function createMongoStore({ dataDir, env }) {
    const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
    const uri = env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
    const databaseName = (env.MONGODB_DB || 'portfolio').trim();
    if (!databaseName) throw new Error('MONGODB_DB must not be empty.');
    if (env.MONGODB_DNS_SERVERS) {
        const dnsServers = env.MONGODB_DNS_SERVERS.split(',').map(server => server.trim()).filter(Boolean);
        if (!dnsServers.length) throw new Error('MONGODB_DNS_SERVERS must contain at least one DNS server.');
        dns.setServers(dnsServers);
    }

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        const database = client.db(databaseName);
        const migrations = database.collection('portfolio_migrations');
        const resumeBucket = new GridFSBucket(database, { bucketName: 'resumes' });
        const resumeSettings = database.collection('portfolio_settings');

        function resumeRecord(file, activeId) {
            return {
                id: String(file._id),
                filename: file.filename,
                size: file.length,
                uploadedAt: file.uploadDate.toISOString(),
                active: String(file._id) === activeId
            };
        }

        async function getResumeFile(id) {
            if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) return null;
            return database.collection('resumes.files').findOne({ _id: new ObjectId(id) });
        }

        async function migrateCollection(name) {
            const migrationId = `json-import:${name}`;
            const target = database.collection(name);
            if (await migrations.findOne({ _id: migrationId })) {
                if (collections.includes(name)) {
                    await target.updateMany(
                        { $or: [{ id: { $exists: false } }, { id: null }, { id: '' }] },
                        [{ $set: { id: { $toString: '$_id' } } }]
                    );
                }
                return;
            }

            const existingCount = await target.countDocuments();
            const records = existingCount ? [] : await readLegacyList(dataDir, name);
            const used = new Set();
            const documents = records.map((record, index) => {
                let id = record.id;
                if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || used.has(id)) {
                    id = crypto.randomUUID();
                }
                used.add(id);
                const fields = { ...record };
                delete fields.id;
                delete fields._id;
                delete fields._order;
                return { ...fields, _id: id, _order: records.length - index };
            });
            if (documents.length) {
                await target.bulkWrite(documents.map(document => ({
                    replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true }
                })), { ordered: true });
            }
            if (collections.includes(name)) {
                await target.updateMany(
                    { $or: [{ id: { $exists: false } }, { id: null }, { id: '' }] },
                    [{ $set: { id: { $toString: '$_id' } } }]
                );
            }
            await database.collection('portfolio_sequences').updateOne(
                { _id: name },
                { $max: { value: Math.max(records.length, existingCount) } },
                { upsert: true }
            );
            await migrations.insertOne({ _id: migrationId, completedAt: new Date() });
        }

        for (const collection of collections) await migrateCollection(collection);
        await migrateCollection('contacts');

        async function read(collection) {
            if (!collections.includes(collection)) {
                throw Object.assign(new Error('Content section not found.'), { status: 404 });
            }
            const records = await database.collection(collection).find({}, { projection: { _order: 0 } })
                .sort({ _order: -1, _id: 1 }).toArray();
            return records.map(publicRecord);
        }

        async function mutate(collection, operation, id, body) {
            if (!collections.includes(collection)) {
                throw Object.assign(new Error('Content section not found.'), { status: 404 });
            }
            const target = database.collection(collection);
            if (operation === 'add') {
                const value = validateContent(collection, body);
                const sequence = await database.collection('portfolio_sequences').findOneAndUpdate(
                    { _id: collection },
                    { $inc: { value: 1 } },
                    { upsert: true, returnDocument: 'after', includeResultMetadata: false }
                );
                const item = { id: crypto.randomUUID(), ...value };
                await target.insertOne({ _id: item.id, _order: sequence.value, ...value });
                return { item, items: await read(collection) };
            }

            const selectors = [{ _id: id }];
            if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
                selectors.push({ _id: new ObjectId(id) });
            }
            const existing = await target.findOne({ $or: selectors });
            if (!existing) {
                throw Object.assign(new Error('This item no longer exists. Refresh the dashboard.'), { status: 404 });
            }
            if (operation === 'delete') {
                await target.deleteOne({ _id: existing._id });
                return { items: await read(collection) };
            }
            const value = validateContent(collection, body);
            await target.replaceOne({ _id: existing._id }, { _id: existing._id, _order: existing._order, ...value });
            const item = { id: String(existing._id), ...value };
            return { item, items: await read(collection) };
        }

        async function readContacts() {
            return database.collection('contacts').find({}, { projection: { _id: 0, _order: 0 } })
                .sort({ timestamp: 1, _id: 1 }).toArray();
        }

        async function addContact(entry) {
            await database.collection('contacts').insertOne(entry);
        }

        async function listResumes() {
            const [files, settings] = await Promise.all([
                resumeBucket.find({}).sort({ uploadDate: -1 }).toArray(),
                resumeSettings.findOne({ _id: 'resume-settings' })
            ]);
            const activeId = settings?.activeResumeId ? String(settings.activeResumeId) : '';
            return files.map(file => resumeRecord(file, activeId));
        }

        async function uploadResume(filename, data) {
            const upload = resumeBucket.openUploadStream(filename, { contentType: 'application/pdf' });
            await new Promise((resolve, reject) => {
                upload.once('error', reject);
                upload.once('finish', resolve);
                upload.end(data);
            });
            const file = await getResumeFile(String(upload.id));
            if (!file) throw new Error('Uploaded resume could not be read back from MongoDB.');
            return resumeRecord(file, '');
        }

        async function getResume(id) {
            const file = await getResumeFile(id);
            return file ? resumeRecord(file, '') : null;
        }

        function openResume(id) {
            if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) return null;
            return resumeBucket.openDownloadStream(new ObjectId(id));
        }

        async function getActiveResume() {
            const settings = await resumeSettings.findOne({ _id: 'resume-settings' });
            if (!settings?.activeResumeId) return null;
            return getResume(String(settings.activeResumeId));
        }

        async function setActiveResume(id) {
            const file = await getResumeFile(id);
            if (!file) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            await resumeSettings.updateOne(
                { _id: 'resume-settings' },
                { $set: { activeResumeId: file._id } },
                { upsert: true }
            );
            return listResumes();
        }

        async function deleteResume(id) {
            const file = await getResumeFile(id);
            if (!file) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            await resumeBucket.delete(file._id);
            await resumeSettings.updateOne(
                { _id: 'resume-settings', activeResumeId: file._id },
                { $unset: { activeResumeId: '' } }
            );
            return listResumes();
        }

        return {
            read,
            mutate,
            readContacts,
            addContact,
            listResumes,
            uploadResume,
            getResume,
            openResume,
            getActiveResume,
            setActiveResume,
            deleteResume,
            close: () => client.close()
        };
    } catch (error) {
        await client.close();
        throw error;
    }
}

module.exports = { createMongoStore, publicRecord };
