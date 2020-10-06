const fs = require('fs-extra');
const path = require('path');
const stream = require('stream');
const ApifyStorageLocal = require('../src/index');
const { STORAGE_NAMES } = require('../src/consts');
const { prepareTestDir, removeTestDir } = require('./_tools');

const TEST_STORES = {
    1: {
        name: 'first',
        recordCount: 5,
    },
    2: {
        name: 'second',
        recordCount: 35,
    },
};

/** @type ApifyStorageLocal */
let storageLocal;
let counter;
let STORAGE_DIR;
let storeNameToDir;
beforeEach(() => {
    STORAGE_DIR = prepareTestDir();
    storageLocal = new ApifyStorageLocal({
        storageDir: STORAGE_DIR,
    });
    const keyValueStoresDir = path.join(STORAGE_DIR, STORAGE_NAMES.KEY_VALUE_STORES);
    storeNameToDir = (storeName) => {
        return path.join(keyValueStoresDir, storeName);
    };
    counter = createCounter(keyValueStoresDir);
    seed(keyValueStoresDir);
});

afterAll(() => {
    removeTestDir(STORAGE_NAMES.KEY_VALUE_STORES);
});

test('stores directory exists', () => {
    const subDirs = fs.readdirSync(STORAGE_DIR);
    expect(subDirs).toContain(STORAGE_NAMES.KEY_VALUE_STORES);
});

describe('get store', () => {
    test('returns correct store', async () => {
        let store = await storageLocal.keyValueStore('first').get();
        expect(store.id).toBe('first');
        expect(store.name).toBe('first');
        store = await storageLocal.keyValueStore('second').get();
        expect(store.id).toBe('second');
        expect(store.name).toBe('second');
    });

    test('returns undefined for non-existent stores', async () => {
        const store = await storageLocal.keyValueStore('3').get();
        expect(store).toBeUndefined();
    });
});

describe('getOrCreate', () => {
    test('returns existing store by name', async () => {
        const store = await storageLocal.keyValueStores().getOrCreate('first');
        expect(store.id).toBe('first');
        const count = counter.stores();
        expect(count).toBe(2);
    });

    test('creates a new store with name', async () => {
        const storeName = 'third';
        const store = await storageLocal.keyValueStores().getOrCreate(storeName);
        expect(store.id).toBe('third');
        expect(store.name).toBe(storeName);
        const count = counter.stores();
        expect(count).toBe(3);
    });
});

describe('delete store', () => {
    test('deletes correct store', async () => {
        await storageLocal.keyValueStore('first').delete();
        const count = counter.stores();
        expect(count).toBe(1);
    });

    test('returns undefined for non-existent store', async () => {
        const result = await storageLocal.keyValueStore('non-existent').delete();
        expect(result).toBeUndefined();
    });
});

describe('setRecord', () => {
    const storeName = 'first';
    const startCount = TEST_STORES[1].recordCount;

    test('adds a value', async () => { /* eslint-disable no-shadow */
        const record = numToRecord(startCount + 1);

        await storageLocal.keyValueStore(storeName).setRecord(stripRecord(record));
        expect(counter.records(storeName)).toBe(startCount + 1);

        const recordPath = path.join(storeNameToDir(storeName), record.filename);
        const savedData = await fs.readFile(recordPath);
        expect(savedData).toEqual(Buffer.from(record.value));
    });

    test('updates when key is already present', async () => {
        const seededRecord = numToRecord(1);
        const newRecord = stripRecord(seededRecord);
        newRecord.value = Buffer.from('abc');

        await storageLocal.keyValueStore(storeName).setRecord(newRecord);
        expect(counter.records(storeName)).toBe(startCount);
        const recordPath = path.join(storeNameToDir(storeName), seededRecord.filename);
        const savedData = await fs.readFile(recordPath);
        expect(savedData).toEqual(newRecord.value);
    });

    test('setRecord() works with text', async () => {
        const key = 'some-key';
        const value = 'someValue';
        const expectedExtension = '.txt';

        const res = await storageLocal.keyValueStore(storeName).setRecord({ key, value });
        expect(res).toBeUndefined();

        const recordPath = path.join(storeNameToDir(storeName), key + expectedExtension);
        const savedData = await fs.readFile(recordPath, 'utf8');
        expect(savedData).toEqual(value);
    });

    test('setRecord() works with object', async () => {
        const key = 'some-key';
        const value = { foo: 'bar', one: 1 };
        const expectedExtension = '.json';

        const res = await storageLocal.keyValueStore(storeName).setRecord({ key, value });
        expect(res).toBeUndefined();

        const recordPath = path.join(storeNameToDir(storeName), key + expectedExtension);
        const savedData = await fs.readFile(recordPath, 'utf8');
        expect(JSON.parse(savedData)).toEqual(value);
    });

    test('setRecord() works with buffer', async () => {
        const key = 'some-key';
        const string = 'special chars 🤖✅';
        const value = Buffer.from(string);
        const expectedExtension = '.bin';

        const res = await storageLocal.keyValueStore(storeName).setRecord({ key, value });
        expect(res).toBeUndefined();

        const recordPath = path.join(storeNameToDir(storeName), key + expectedExtension);
        const savedData = await fs.readFile(recordPath);
        expect(savedData).toEqual(value);
    });

    test('setRecord() works with pre-stringified JSON', async () => {
        const key = 'some-key';
        const contentType = 'application/json; charset=utf-8';
        const value = JSON.stringify({ foo: 'bar', one: 1 });
        const expectedExtension = '.json';

        const res = await storageLocal.keyValueStore(storeName).setRecord({ key, value, contentType });
        expect(res).toBeUndefined();

        const recordPath = path.join(storeNameToDir(storeName), key + expectedExtension);
        const savedData = await fs.readFile(recordPath, 'utf8');
        expect(savedData).toEqual(value);
    });

    describe('throws', () => {
        test('when store does not exist', async () => {
            const id = 'non-existent';
            try {
                await storageLocal.keyValueStore(id).setRecord({ key: 'some-key', value: 'some-value' });
                throw new Error('wrong-error');
            } catch (err) {
                expect(err.message).toBe(`Key-value store with id: ${id} does not exist.`);
            }
        });
    });
});

describe('getRecord', () => {
    const storeName = 'first';
    const startCount = TEST_STORES[1].recordCount;

    test('gets values', async () => {
        let savedRecord = numToRecord(3);
        let record = await storageLocal.keyValueStore(storeName).getRecord(savedRecord.key);
        expect(record).toEqual(stripRecord(savedRecord));
        savedRecord = numToRecord(30);
        record = await storageLocal.keyValueStore('second').getRecord(savedRecord.key);
        expect(record).toEqual(stripRecord(savedRecord));
    });

    test('returns undefined for non-existent records', async () => {
        const savedRecord = numToRecord(startCount + 1);
        const record = await storageLocal.keyValueStore('first').getRecord(savedRecord.key);
        expect(record).toBeUndefined();
    });

    test('parses JSON', async () => {
        let savedRecord = numToRecord(1);
        let expectedRecord = stripRecord(savedRecord);
        expectedRecord.value = JSON.parse(expectedRecord.value);
        let record = await storageLocal.keyValueStore(storeName).getRecord(savedRecord.key);
        expect(record).toEqual(expectedRecord);

        savedRecord = numToRecord(10);
        expectedRecord = stripRecord(savedRecord);
        expectedRecord.value = JSON.parse(expectedRecord.value);
        record = await storageLocal.keyValueStore('second').getRecord(savedRecord.key);
        expect(record).toEqual(stripRecord(expectedRecord));
    });

    test('returns buffer when selected', async () => {
        const savedRecord = numToRecord(1);
        const expectedRecord = stripRecord(savedRecord);
        expectedRecord.value = Buffer.from(savedRecord.value);
        const record = await storageLocal.keyValueStore(storeName).getRecord(savedRecord.key, { buffer: true });
        expect(record).toEqual(expectedRecord);
    });

    test('returns buffer for non-text content-types', async () => {
        const savedRecord = numToRecord(7);
        const expectedRecord = stripRecord(savedRecord);
        expectedRecord.value = Buffer.from(savedRecord.value);
        const record = await storageLocal.keyValueStore('second').getRecord(savedRecord.key);
        expect(record).toEqual(expectedRecord);
        expect(record.value).toBeInstanceOf(Buffer);
    });

    test('returns stream when selected', async () => {
        const savedRecord = numToRecord(1);
        const expectedRecord = stripRecord(savedRecord);

        const record = await storageLocal.keyValueStore(storeName).getRecord(savedRecord.key, { stream: true });
        expect(record.value).toBeInstanceOf(stream.Readable);
        const chunks = [];
        for await (const chunk of record.value) {
            chunks.push(chunk);
        }
        record.value = Buffer.concat(chunks).toString();
        expect(record).toEqual(expectedRecord);
    });

    describe('throws', () => {
        test('when store does not exist', async () => {
            const id = 'non-existent';
            try {
                await storageLocal.keyValueStore(id).getRecord('some-key');
                throw new Error('wrong-error');
            } catch (err) {
                expect(err.message).toBe(`Key-value store with id: ${id} does not exist.`);
            }
        });
    });
});

describe('deleteRecord', () => {
    const storeName = 'first';
    const startCount = TEST_STORES[1].recordCount;

    test('deletes record', async () => {
        const record = numToRecord(3);
        const recordPath = path.join(storeNameToDir(storeName), record.filename);
        await fs.readFile(recordPath);
        await storageLocal.keyValueStore(storeName).deleteRecord(record.key);
        try {
            await fs.readFile(recordPath);
            throw new Error('wrong error');
        } catch (err) {
            expect(err.code).toBe('ENOENT');
        }
    });

    test('returns undefined for non-existent records', async () => {
        const savedRecord = numToRecord(startCount + 1);
        const record = await storageLocal.keyValueStore('first').deleteRecord(savedRecord.key);
        expect(record).toBeUndefined();
    });

    describe('throws', () => {
        test('when store does not exist', async () => {
            const id = 'non-existent';
            try {
                await storageLocal.keyValueStore(id).deleteRecord('some-key');
                throw new Error('wrong-error');
            } catch (err) {
                expect(err.message).toBe(`Key-value store with id: ${id} does not exist.`);
            }
        });
    });
});

describe('listKeys', () => {
    const store = TEST_STORES[2];

    test('fetches keys in correct order', async () => {
        const records = createRecords(store);
        const expectedKeys = records
            .map((r) => ({ key: r.key, size: r.size }))
            .sort((a, b) => {
                if (a.key < b.key) return -1;
                if (a.key > b.key) return 1;
                return 0;
            });

        const { items } = await storageLocal.keyValueStore(store.name).listKeys();
        expect(items).toEqual(expectedKeys);
    });

    test('limit works', async () => {
        const limit = 10;
        const records = createRecords(store);
        const expectedItems = records
            .map((r) => ({ key: r.key, size: r.size }))
            .sort((a, b) => {
                if (a.key < b.key) return -1;
                if (a.key > b.key) return 1;
                return 0;
            })
            .slice(0, limit);

        const { items } = await storageLocal.keyValueStore(store.name).listKeys({ limit });
        expect(items).toEqual(expectedItems);
    });

    test('exclusive start key works', async () => {
        const records = createRecords(store);
        const expectedItems = records
            .map((r) => ({ key: r.key, size: r.size }))
            .sort((a, b) => {
                if (a.key < b.key) return -1;
                if (a.key > b.key) return 1;
                return 0;
            });
        const idx = 10;
        const exclusiveStartKey = expectedItems[idx].key;
        const exclusiveItems = expectedItems.slice(idx + 1);

        const { items } = await storageLocal.keyValueStore(store.name).listKeys({ exclusiveStartKey });
        expect(items).toEqual(exclusiveItems);
    });

    describe('throws', () => {
        test('when store does not exist', async () => {
            const id = 'non-existent';
            try {
                await storageLocal.keyValueStore(id).listKeys();
                throw new Error('wrong-error');
            } catch (err) {
                expect(err.message).toBe(`Key-value store with id: ${id} does not exist.`);
            }
        });
    });
});

describe('timestamps:', () => {
    const storeName = 'first';
    const testInitTimestamp = Date.now();

    test('createdAt has a valid date', async () => {
        const { createdAt } = await storageLocal.keyValueStore(storeName).get();
        const createdAtTimestamp = createdAt.getTime();
        expect(createdAtTimestamp).toBeGreaterThan(testInitTimestamp);
        expect(createdAtTimestamp).toBeLessThan(Date.now());
    });

    test('get updated on record update', async () => {
        const beforeUpdate = await storageLocal.keyValueStore(storeName).get();
        const record = numToRecord(1);
        await storageLocal.keyValueStore(storeName).setRecord(stripRecord(record));
        const afterUpdate = await storageLocal.keyValueStore(storeName).get();
        expect(afterUpdate.modifiedAt.getTime()).toBeGreaterThan(beforeUpdate.modifiedAt.getTime());
        expect(afterUpdate.accessedAt.getTime()).toBeGreaterThan(beforeUpdate.accessedAt.getTime());
    });

    test('get updated on record insert', async () => {
        const beforeUpdate = await storageLocal.keyValueStore(storeName).get();
        const record = numToRecord(100);
        await storageLocal.keyValueStore(storeName).setRecord(stripRecord(record));
        const afterUpdate = await storageLocal.keyValueStore(storeName).get();
        expect(afterUpdate.modifiedAt.getTime()).toBeGreaterThan(beforeUpdate.modifiedAt.getTime());
        expect(afterUpdate.accessedAt.getTime()).toBeGreaterThan(beforeUpdate.accessedAt.getTime());
    });

    test('get updated on record delete', async () => {
        const beforeUpdate = await storageLocal.keyValueStore(storeName).get();
        const record = numToRecord(1);
        await storageLocal.keyValueStore(storeName).deleteRecord(record.key);
        const afterUpdate = await storageLocal.keyValueStore(storeName).get();
        expect(afterUpdate.modifiedAt.getTime()).toBeGreaterThan(beforeUpdate.modifiedAt.getTime());
        expect(afterUpdate.accessedAt.getTime()).toBeGreaterThan(beforeUpdate.accessedAt.getTime());
    });

    test('getRecord updates accessedAt', async () => {
        const beforeGet = await storageLocal.keyValueStore(storeName).get();
        const { key } = numToRecord(1);
        await storageLocal.keyValueStore(storeName).getRecord(key);
        const afterGet = await storageLocal.keyValueStore(storeName).get();
        expect(beforeGet.modifiedAt.getTime()).toBe(afterGet.modifiedAt.getTime());
        expect(afterGet.accessedAt.getTime()).toBeGreaterThan(beforeGet.accessedAt.getTime());
    });

    test('listKeys updates accessedAt', async () => {
        const beforeGet = await storageLocal.keyValueStore(storeName).get();
        await storageLocal.keyValueStore(storeName).listKeys();
        const afterGet = await storageLocal.keyValueStore(storeName).get();
        expect(beforeGet.modifiedAt.getTime()).toBe(afterGet.modifiedAt.getTime());
        expect(afterGet.accessedAt.getTime()).toBeGreaterThan(beforeGet.accessedAt.getTime());
    });
});

function seed(keyValueStoresDir) {
    Object.values(TEST_STORES).forEach((store) => {
        const storeDir = insertStore(keyValueStoresDir, store);
        const records = createRecords(store);
        insertRecords(storeDir, records);
    });
}

function insertStore(dir, store) {
    const storeDir = path.join(dir, store.name);
    fs.ensureDirSync(storeDir);
    fs.emptyDirSync(storeDir);
    return storeDir;
}

function insertRecords(dir, records) {
    records.forEach((record) => {
        const filePath = path.join(dir, record.filename);
        fs.writeFileSync(filePath, record.value);
    });
}

function createRecords(store) {
    const records = [];
    for (let i = 0; i < store.recordCount; i++) {
        const record = numToRecord(i);
        records.push(record);
    }
    return records;
}

function numToRecord(num) {
    if (num % 3 === 0) {
        const key = `markup_${num}`;
        const value = `<html><body>${num}: ✅</body></html>`;
        return {
            key,
            value,
            filename: `${key}.html`,
            contentType: 'text/html; charset=utf-8',
            size: Buffer.byteLength(value),
        };
    }
    if (num % 7 === 0) {
        const key = `buffer_${num}`;
        const chunks = Array(5000).fill(`${num}🚀🎯`);
        const value = Buffer.from(chunks);
        return {
            key,
            value,
            filename: `${key}.bin`,
            contentType: 'application/octet-stream',
            size: value.byteLength,
        };
    }
    const key = `object_${num}`;
    const filename = `${key}.json`;
    const value = JSON.stringify({ number: num, filename });
    return {
        key,
        value,
        filename,
        contentType: 'application/json; charset=utf-8',
        size: Buffer.byteLength(value),
    };
}

function stripRecord(record) {
    const { filename, size, ...strippedRecord } = record;
    return strippedRecord;
}

function createCounter(keyValueStoresDir) {
    return {
        stores() {
            return fs.readdirSync(keyValueStoresDir).length;
        },
        records(name) {
            return fs.readdirSync(path.join(keyValueStoresDir, name)).length;
        },
    };
}
