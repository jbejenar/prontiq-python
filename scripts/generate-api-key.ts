/**
 * Generate a test API key and insert it into DynamoDB.
 * Usage: npx tsx scripts/generate-api-key.ts [--tier free|starter|growth] [--stage dev|staging|prod]
 */

import { randomBytes } from "node:crypto";

const tier = process.argv.includes("--tier")
  ? process.argv[process.argv.indexOf("--tier") + 1]
  : "free";

const prefix = "pq_test_";
const key = `${prefix}${randomBytes(24).toString("hex")}`;

console.log(`Generated API key: ${key}`);
console.log(`Tier: ${tier}`);
console.log("");
console.log("TODO: Insert into DynamoDB using @aws-sdk/lib-dynamodb");
console.log("TODO: Accept --stage flag to target different DynamoDB tables");
