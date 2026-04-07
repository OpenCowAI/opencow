// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UploadPolicyService } from '../../../electron/browser/upload'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('UploadPolicyService', () => {
  it('validates and normalizes files under project root', async () => {
    const root = await makeTempDir('oc-upload-policy-root-')
    const nestedDir = path.join(root, 'assets')
    await fs.mkdir(nestedDir, { recursive: true })
    const filePath = path.join(nestedDir, 'avatar.png')
    await fs.writeFile(filePath, 'hello')
    const realFilePath = await fs.realpath(filePath)

    const service = new UploadPolicyService()
    const result = await service.validateFiles(['assets/avatar.png'], {
      projectPath: root,
      startupCwd: root,
    })

    expect(result.files).toEqual([realFilePath])
    expect(result.totalBytes).toBe(5)
    expect(result.rootRealPath).toBe(await fs.realpath(root))
  })

  it('rejects when projectPath context is missing', async () => {
    const service = new UploadPolicyService()
    await expect(
      service.validateFiles(['/tmp/a.txt'], {
        projectPath: null,
      }),
    ).rejects.toMatchObject({
      code: 'SENSITIVE_ACTION_DENIED',
      action: 'browser_upload',
    })
  })

  it('rejects files outside project root', async () => {
    const root = await makeTempDir('oc-upload-policy-root-')
    const outsideBase = await makeTempDir('oc-upload-policy-outside-')
    const outsideFile = path.join(outsideBase, 'secret.txt')
    await fs.writeFile(outsideFile, 'secret')

    const service = new UploadPolicyService()
    await expect(
      service.validateFiles([outsideFile], {
        projectPath: root,
        startupCwd: root,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_ALLOWED',
    })
  })

  it('rejects total size over configured threshold', async () => {
    const root = await makeTempDir('oc-upload-policy-size-')
    const fileA = path.join(root, 'a.bin')
    const fileB = path.join(root, 'b.bin')
    await fs.writeFile(fileA, '12345')
    await fs.writeFile(fileB, '67890')

    const service = new UploadPolicyService({
      maxFilesPerUpload: 10,
      maxFileSizeBytes: 100,
      maxTotalUploadSizeBytes: 9,
    })

    await expect(
      service.validateFiles([fileA, fileB], {
        projectPath: root,
        startupCwd: root,
      }),
    ).rejects.toMatchObject({
      code: 'UPLOAD_TOTAL_TOO_LARGE',
    })
  })
})

