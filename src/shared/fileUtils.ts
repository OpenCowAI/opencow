// SPDX-License-Identifier: Apache-2.0

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', html: 'html',
    css: 'css', scss: 'scss', less: 'less',
    py: 'python', rs: 'rust', go: 'go',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', graphql: 'graphql',
    xml: 'xml', svg: 'xml',
  }
  return map[ext] ?? 'plaintext'
}

export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const binaryExts = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif',
    'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
    'zip', 'tar', 'gz', 'rar', '7z',
    'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'exe', 'dll', 'so', 'dylib',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
  ])
  return binaryExts.has(ext)
}

/** Max file size we'll load into the editor (5 MB) */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
