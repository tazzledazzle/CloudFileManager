// lambda/virus-definition-updater/index.ts
import {Context, ScheduledEvent} from 'aws-lambda';
import {S3Client, PutObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as child_process from 'child_process';
import {createWriteStream} from 'fs';
import * as https from 'https';

// Initialize clients
const s3Client = new S3Client({});

// Environment variables
const VIRUS_DEFS_BUCKET = process.env.VIRUS_DEFS_BUCKET!;
const VIRUS_DEFS_PREFIX = process.env.VIRUS_DEFS_PREFIX || 'virus-definitions/';
const CLAMAV_PATH = '/opt/clamav';
const TEMP_DIR = '/tmp/clamav_defs';

// ClamAV definition files to update
const DEFINITION_FILES = [
    'main.cvd',      // Main virus database
    'daily.cvd',     // Daily updates
    'bytecode.cvd',  // Bytecode signatures
];

// ClamAV download mirrors
const CLAMAV_MIRRORS = [
    'https://database.clamav.net/main.cvd',
    'https://database.clamav.net/daily.cvd',
    'https://database.clamav.net/bytecode.cvd',
];

// Promisify exec
const exec = util.promisify(child_process.exec);

/**
 * Downloads a file from a URL to a local path
 */
async function downloadFile(url: string, localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(localPath);

        console.log(`Downloading ${url} to ${localPath}`);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`Successfully downloaded ${url}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(localPath, () => {
            }); // Delete the file on error
            reject(err);
        });
    });
}

/**
 * Try to update virus definitions using freshclam
 */
async function updateWithFreshclam(): Promise<boolean> {
    try {
        console.log('Attempting to update virus definitions with freshclam');

        // Create temp directory if it doesn't exist
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, {recursive: true});
        }

        // Create a temporary freshclam.conf
        const configPath = path.join(TEMP_DIR, 'freshclam.conf');
        fs.writeFileSync(configPath, `
DatabaseDirectory ${TEMP_DIR}
LogTime yes
LogVerbose yes
LogSyslog no
LogFile ${TEMP_DIR}/freshclam.log
PidFile ${TEMP_DIR}/freshclam.pid
DatabaseOwner root
DatabaseMirror database.clamav.net
MaxAttempts 5
ScriptedUpdates yes
`);

        // Run freshclam to update the virus definitions
        const {stdout, stderr} = await exec(
            `${CLAMAV_PATH}/bin/freshclam --config-file=${configPath} --datadir=${TEMP_DIR}`,
            {maxBuffer: 10 * 1024 * 1024} // 10MB buffer
        );

        console.log('Freshclam stdout:', stdout);

        if (stderr) {
            console.warn('Freshclam stderr:', stderr);
        }

        // Check if the virus definition files exist
        const filesExist = DEFINITION_FILES.every(file =>
            fs.existsSync(path.join(TEMP_DIR, file))
        );

        if (!filesExist) {
            console.log('Not all virus definition files were downloaded by freshclam');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error updating virus definitions with freshclam:', error);
        return false;
    }
}

/**
 * Fallback to direct download of definition files
 */
async function directDownloadDefinitions(): Promise<boolean> {
    try {
        console.log('Attempting direct download of virus definition files');

        // Create temp directory if it doesn't exist
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, {recursive: true});
        }

        // Download each definition file
        for (let i = 0; i < DEFINITION_FILES.length; i++) {
            const file = DEFINITION_FILES[i];
            const url = CLAMAV_MIRRORS[i];
            const localPath = path.join(TEMP_DIR, file);

            await downloadFile(url, localPath);
        }

        // Verify all files were downloaded
        const allDownloaded = DEFINITION_FILES.every(file =>
            fs.existsSync(path.join(TEMP_DIR, file))
        );

        if (!allDownloaded) {
            throw new Error('Not all definition files were downloaded');
        }

        return true;
    } catch (error) {
        console.error('Error directly downloading virus definitions:', error);
        return false;
    }
}

/**
 * Upload the virus definition files to S3
 */
async function uploadDefinitionsToS3(): Promise<void> {
    console.log('Uploading virus definition files to S3');

    for (const file of DEFINITION_FILES) {
        const localPath = path.join(TEMP_DIR, file);
        const s3Key = `${VIRUS_DEFS_PREFIX}${file}`;

        // Read file
        const fileContent = fs.readFileSync(localPath);

        // Upload to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: VIRUS_DEFS_BUCKET,
            Key: s3Key,
            Body: fileContent,
            ContentType: 'application/octet-stream',
            Metadata: {
                'updated-date': new Date().toISOString(),
            },
        }));

        console.log(`Uploaded ${file} to s3://${VIRUS_DEFS_BUCKET}/${s3Key}`);
    }
}

/**
 * Check if definitions need updating
 */
async function definitionsNeedUpdate(): Promise<boolean> {
    try {
        // Check the last update date of the main virus database
        const s3Key = `${VIRUS_DEFS_PREFIX}main.cvd`;

        const command = new HeadObjectCommand({
            Bucket: VIRUS_DEFS_BUCKET,
            Key: s3Key,
        });

        try {
            const response = await s3Client.send(command);

            if (response.Metadata && response.Metadata['updated-date']) {
                const lastUpdate = new Date(response.Metadata['updated-date']);
                const now = new Date();

                // Calculate hours since last update
                const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

                // Update if more than 24 hours since last update
                return hoursSinceUpdate > 24;
            }
        } catch (error: any) {
            // If file doesn't exist, we need to update
            if (error.name === 'NotFound') {
                return true;
            }
            throw error;
        }

        // Default to updating
        return true;
    } catch (error) {
        console.error('Error checking if definitions need update:', error);
        // On error, assume we need to update
        return true;
    }
}

/**
 * Lambda handler for updating virus definitions
 */
export const handler = async (event: ScheduledEvent, context: Context): Promise<void> => {
    console.log('Starting virus definition update');

    try {
        // Check if update is needed
        const needsUpdate = await definitionsNeedUpdate();

        if (!needsUpdate) {
            console.log('Virus definitions are up to date, skipping update');
            return;
        }

        // First, try to update with freshclam
        let updateSuccess = await updateWithFreshclam();

        // If freshclam fails, try direct download
        if (!updateSuccess) {
            console.log('Freshclam update failed, trying direct download');
            updateSuccess = await directDownloadDefinitions();
        }

        if (updateSuccess) {
            // Upload to S3
            await uploadDefinitionsToS3();
            console.log('Virus definition update completed successfully');
        } else {
            throw new Error('Failed to update virus definitions using all methods');
        }
    } catch (error) {
        console.error('Error updating virus definitions:', error);
        throw error;
    } finally {
        // Clean up temp files
        try {
            if (fs.existsSync(TEMP_DIR)) {
                fs.rmSync(TEMP_DIR, {recursive: true, force: true});
            }
        } catch (cleanupError) {
            console.warn('Error cleaning up temporary files:', cleanupError);
        }
    }
};