# Security policy

## Supported versions

Security fixes are provided for the latest released minor version.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a
public issue containing exploit details, credentials, or sensitive logs.

Include the affected version, deployment shape, reproduction steps, impact, and
any suggested mitigation. Acknowledgement and next-step timing will be provided
after the report is reproduced and scoped.

## Security model

This plugin controls tool visibility through the Harness composition layer. It
is not an authorization boundary. Deployments must retain appropriate approval,
sandbox, credential, network, and tool-guard policies.
