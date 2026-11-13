import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTIFACTS_DIR } from './config.js';

/** A fresh random 32-byte jar salt. */
export function generateJarId(): Uint8Array {
    return new Uint8Array(randomBytes(32));
}

/** Writes a run artifact under `artifacts/` and returns its path. */
export function writeArtifact(name: string, contents: string): string {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const path = resolve(ARTIFACTS_DIR, name);
    writeFileSync(path, contents.endsWith('\n') ? contents : `${contents}\n`);
    return path;
}
