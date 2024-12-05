import admin from 'firebase-admin';

export interface FirebaseLoggerConfig {
  serviceAccount?: string;
  databaseURL?: string;
  database?: admin.database.Database;
}

export class FirebaseLogger {
  private db: admin.database.Database | null = null;

  constructor(config: FirebaseLoggerConfig) {
    if (config.database) {
      this.db = config.database;
    } else if (config.serviceAccount && config.databaseURL) {
      try {
        const serviceAccount = typeof config.serviceAccount === 'string'
          ? JSON.parse(config.serviceAccount)
          : config.serviceAccount;

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: config.databaseURL
        });
        this.db = admin.database();
      } catch (error) {
        throw new Error(`Failed to initialize Firebase: ${error}`);
      }
    } else {
      throw new Error('Either database instance or serviceAccount + databaseURL must be provided');
    }
  }

  /**
   * Log content to a specific Firebase reference path
   * @param refPath - The database reference path where the log should be stored
   * @param content - The content to be logged
   * @param type - Optional type of the log entry
   * @returns Promise that resolves when the log is written
   */
  async log(refPath: string, content: any, type?: string): Promise<void> {
    if (!this.db) {
      throw new Error('Firebase database not initialized');
    }

    const logRef = this.db.ref(refPath);

    try {
      await logRef.push({
        timestamp: new Date().toISOString(),
        type: type || 'general',
        content: typeof content === 'object' ? JSON.stringify(content) : content
      });
    } catch (error) {
      throw new Error(`Failed to write to Firebase: ${error}`);
    }
  }

  /**
   * Get database reference for custom operations
   * @returns Firebase Database instance
   */
  getDatabase(): admin.database.Database | null {
    return this.db;
  }
}

// Factory function to create a new logger instance
export function createFirebaseLogger(config: FirebaseLoggerConfig): FirebaseLogger {
  return new FirebaseLogger(config);
}