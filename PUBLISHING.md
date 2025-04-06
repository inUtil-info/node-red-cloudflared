# Publishing to npm

This document contains instructions for publishing the package to npm.

## Prerequisites

1. Make sure you have an npm account and are logged in:

   ```bash
   npm login
   ```

2. Ensure you have permission to publish to the @inutil-labs organization.

## Steps to Publish

1. Verify that all changes are committed to the repository:

   ```bash
   git status
   ```

2. Run the following commands to publish:

   ```bash
   # Test the package
   npm test # if you have tests

   # Publish to npm
   npm publish --access public
   ```

3. If you want to create a Git tag for the release:
   ```bash
   git tag v0.0.5
   git push origin v0.0.5
   ```

## Troubleshooting

- If you get a 403 error, make sure you have permission to publish to the @inutil-labs organization.
- If you get a 'version already exists' error, ensure you've updated the version in package.json.

## Post-publication

After successful publication:

1. Verify that your package appears on npm: https://www.npmjs.com/package/@inutil-labs/node-red-cloudflare-tunnels
2. Update the GitHub repository with the changes:
   ```bash
   git push origin main
   ```
