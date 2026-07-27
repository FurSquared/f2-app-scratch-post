import type { MicroAppStorage } from '../src'

const databaseName = 'fur-2-k-micro-app-storage'
const databaseVersion = 1
const entriesStoreName = 'entries'

type StoredEntry = {
  appId: string
  key: string
  value: unknown
}

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(entriesStoreName)) {
        request.result.createObjectStore(entriesStoreName, {
          keyPath: ['appId', 'key'],
        })
      }
    })
    request.addEventListener('success', () => {
      const database = request.result
      database.addEventListener('versionchange', () => {
        database.close()
        databasePromise = undefined
      })
      resolve(database)
    })
    request.addEventListener('error', () => {
      databasePromise = undefined
      reject(request.error ?? new Error('Unable to open micro-app storage'))
    })
  })

  return databasePromise
}

function requestResult<Result>(request: IDBRequest<Result>) {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Micro-app storage request failed'))
    })
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Micro-app storage transaction aborted'))
    })
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Micro-app storage transaction failed'))
    })
  })
}

function validateKey(key: string) {
  if (!key || key.length > 128) throw new Error('Invalid micro-app storage key')
}

function entryRange(appId: string, prefix = '') {
  return IDBKeyRange.bound([appId, prefix], [appId, `${prefix}\uffff`])
}

export function createMicroAppStorage(appId: string): MicroAppStorage {
  if (!appId) throw new Error('A micro-app id is required for storage')

  return {
    async get<Value>(key: string) {
      validateKey(key)
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readonly')
      const entry = await requestResult<StoredEntry | undefined>(
        transaction.objectStore(entriesStoreName).get([appId, key])
      )
      return entry?.value as Value | undefined
    },

    async set<Value>(key: string, value: Value) {
      validateKey(key)
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readwrite')
      transaction.objectStore(entriesStoreName).put({ appId, key, value } satisfies StoredEntry)
      await transactionComplete(transaction)
    },

    async getMany<Value>(keys: string[]) {
      keys.forEach(validateKey)
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readonly')
      const store = transaction.objectStore(entriesStoreName)
      const values = await Promise.all(
        keys.map(async (key) => {
          const entry = await requestResult<StoredEntry | undefined>(store.get([appId, key]))
          return [key, entry?.value] as const
        })
      )

      return new Map(
        values.flatMap(([key, value]) =>
          value === undefined ? [] : [[key, value as Value] as const]
        )
      )
    },

    async setMany(entries) {
      const storedEntries = Array.from(entries, ([key, value]) => {
        validateKey(key)
        return { appId, key, value } satisfies StoredEntry
      })
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readwrite')
      const store = transaction.objectStore(entriesStoreName)
      storedEntries.forEach((entry) => store.put(entry))
      await transactionComplete(transaction)
    },

    async entries<Value>(
      {
        prefix = '',
        limit = 100,
        cursor,
      }: {
        prefix?: string
        limit?: number
        cursor?: string
      } = {}
    ) {
      if (prefix.length > 128) throw new Error('Invalid micro-app storage prefix')
      if (cursor !== undefined) {
        validateKey(cursor)
        if (!cursor.startsWith(prefix)) throw new Error('Invalid micro-app storage cursor')
      }
      if (!Number.isFinite(limit)) throw new Error('Invalid micro-app storage page limit')
      const pageSize = Math.max(1, Math.min(1000, Math.floor(limit)))
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readonly')
      const store = transaction.objectStore(entriesStoreName)
      const range = cursor
        ? IDBKeyRange.bound([appId, cursor], [appId, `${prefix}\uffff`], true)
        : entryRange(appId, prefix)

      return new Promise<{ entries: Array<[string, Value]>; cursor?: string }>(
        (resolve, reject) => {
          const page: Array<[string, Value]> = []
          const request = store.openCursor(range)
          request.addEventListener('success', () => {
            const result = request.result
            if (!result) {
              resolve({ entries: page })
              return
            }
            if (page.length === pageSize) {
              resolve({ entries: page, cursor: page[page.length - 1][0] })
              return
            }

            const entry = result.value as StoredEntry
            page.push([entry.key, entry.value as Value])
            result.continue()
          })
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Micro-app storage iteration failed'))
          })
        }
      )
    },

    async delete(key: string) {
      validateKey(key)
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readwrite')
      transaction.objectStore(entriesStoreName).delete([appId, key])
      await transactionComplete(transaction)
    },

    async clear() {
      const database = await openDatabase()
      const transaction = database.transaction(entriesStoreName, 'readwrite')
      transaction.objectStore(entriesStoreName).delete(entryRange(appId))
      await transactionComplete(transaction)
    },
  }
}
