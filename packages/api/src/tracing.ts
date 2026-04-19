import AWSXRay from "aws-xray-sdk-core";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const { captureAWSv3Client } = AWSXRay;
const SEGMENT_CONTEXT_KEY = "segment";

function getActiveSegment() {
  if (!AWSXRay.isAutomaticMode()) {
    return undefined;
  }

  return AWSXRay.getNamespace().get(SEGMENT_CONTEXT_KEY);
}

export function captureDynamoClient(client: DynamoDBClient): DynamoDBClient {
  return captureAWSv3Client(client);
}

export async function withOpenSearchSubsegment<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const segment = getActiveSegment();
  if (!segment) {
    return fn();
  }

  const subsegment = segment.addNewSubsegment("OpenSearch");
  subsegment.addAnnotation("operation", operation);

  try {
    const result = await fn();
    subsegment.close();
    return result;
  } catch (error) {
    if (error instanceof Error) {
      subsegment.addError(error);
      subsegment.close(error);
    } else {
      subsegment.close();
    }
    throw error;
  }
}
