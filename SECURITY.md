# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue.
2. Email **security@opencow.dev** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
3. We will acknowledge receipt within **48 hours** and provide an estimated timeline for a fix.
4. We will credit you in the security advisory (unless you prefer otherwise).

## Scope

The following areas are in scope for security reports:

- Electron main process privilege escalation
- IPC channel injection or bypass
- Credential exposure (bot tokens, API keys stored in settings)
- File system access beyond intended boundaries (`~/.opencow/`, user-opened project directories)
- Remote code execution through MCP servers or hook payloads
- Cross-site scripting (XSS) in the renderer process

## Out of Scope

- Vulnerabilities in upstream dependencies (please report to the relevant project)
- Issues requiring physical access to the machine
- Social engineering attacks
- Denial of service against local-only services

## Security Architecture

OpenCow follows Electron security best practices:

- **Context isolation** enabled — renderer cannot access Node.js APIs directly
- **Node integration** disabled in renderer
- **Preload scripts** expose only typed, validated IPC channels
- **Content Security Policy** restricts inline scripts and remote resource loading
- **Credential storage** uses the OS keychain via Electron's `safeStorage` API

## Disclosure Timeline

| Step | Timeline |
|------|----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix development | Varies by severity |
| Advisory publication | After fix is released |

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) principles.
