#!/usr/bin/env node
/**
 * S3 Lifecycle Policy Setup Script
 *
 * Applies lifecycle policies to an S3 bucket for automatic data retention.
 *
 * Usage:
 *   node scripts/setup-s3-lifecycle.js <bucket-name> [--dry-run] [--json]
 *
 * Options:
 *   --dry-run  Print the lifecycle configuration without applying it
 *   --json     Output the lifecycle configuration as JSON
 *
 * Environment Variables:
 *   AWS_ACCESS_KEY_ID     - AWS access key
 *   AWS_SECRET_ACCESS_KEY - AWS secret key
 *   AWS_REGION            - AWS region (default: us-east-1)
 *
 * Examples:
 *   node scripts/setup-s3-lifecycle.js porizo-prod
 *   node scripts/setup-s3-lifecycle.js porizo-dev --dry-run
 *   node scripts/setup-s3-lifecycle.js porizo-dev --json > lifecycle.json
 */

const {
  generateLifecycleConfiguration,
  toAWSCLI,
  RETENTION_POLICIES,
} = require('../src/storage/lifecycle');

const args = process.argv.slice(2);
const bucket = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const jsonOutput = args.includes('--json');

if (!bucket) {
  console.error('Usage: node scripts/setup-s3-lifecycle.js <bucket-name> [--dry-run] [--json]');
  console.error('\nOptions:');
  console.error('  --dry-run  Print the lifecycle configuration without applying it');
  console.error('  --json     Output the lifecycle configuration as JSON');
  process.exit(1);
}

const config = generateLifecycleConfiguration();

if (jsonOutput) {
  // Output JSON for piping to aws cli or other tools
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}

console.log('='.repeat(60));
console.log('Porizo S3 Lifecycle Policy Setup');
console.log('='.repeat(60));
console.log();
console.log('Target bucket:', bucket);
console.log();

console.log('Retention Policies:');
console.log('-'.repeat(60));
Object.entries(RETENTION_POLICIES).forEach(([key, policy]) => {
  if (policy.days !== null) {
    console.log(`  ${key.padEnd(20)} ${String(policy.days).padStart(3)} days  ${policy.description}`);
  } else if (key !== 'unknown') {
    console.log(`  ${key.padEnd(20)} ∞        ${policy.description}`);
  }
});
console.log();

console.log('Lifecycle Rules to Apply:');
console.log('-'.repeat(60));
config.Rules.forEach((rule) => {
  const prefix = rule.Filter.Prefix || rule.Filter.And?.Prefix || 'N/A';
  const tags = rule.Filter.And?.Tags ? ` (tag: ${rule.Filter.And.Tags[0].Value})` : '';
  console.log(`  ${rule.ID}`);
  console.log(`    Prefix: ${prefix}${tags}`);
  console.log(`    Expires after: ${rule.Expiration.Days} days`);
  console.log();
});

if (dryRun) {
  console.log('DRY RUN - No changes will be made');
  console.log();
  console.log('To apply manually, run:');
  console.log('-'.repeat(60));
  console.log(toAWSCLI(bucket));
  console.log();
  process.exit(0);
}

// Apply the lifecycle configuration using AWS SDK
async function applyLifecycleConfiguration() {
  try {
    // Dynamic import to avoid requiring AWS SDK if not needed
    const { S3Client, PutBucketLifecycleConfigurationCommand } = await import('@aws-sdk/client-s3');

    const client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: config,
    });

    await client.send(command);

    console.log('✓ Lifecycle configuration applied successfully!');
    console.log();
    console.log('Note: Files matching the stems pattern need to be tagged with:');
    console.log('  lifecycle=stems');
    console.log('when uploaded for automatic expiration to work.');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message?.includes('Cannot find module')) {
      console.error('Error: AWS SDK (@aws-sdk/client-s3) not installed.');
      console.error();
      console.error('Install with: npm install @aws-sdk/client-s3');
      console.error();
      console.error('Or apply manually using the AWS CLI:');
      console.error('-'.repeat(60));
      console.error(toAWSCLI(bucket));
      process.exit(1);
    }
    console.error('Error applying lifecycle configuration:', error.message);
    process.exit(1);
  }
}

applyLifecycleConfiguration();
