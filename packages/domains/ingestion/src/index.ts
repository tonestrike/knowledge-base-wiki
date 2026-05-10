export { ingestionRouter } from './interface/index.ts';
// Re-exported for the api shell's top-level GET handler at
// `/rpc/ingestion/authCallback`, which serves Google's OAuth redirect (a
// GET) by running the same use-case the POST procedure handler does. The
// oRPC procedure stays POST-only so typed RPC clients keep their existing
// contract.
export { completeDriveAuth } from './application/complete-drive-auth.ts';
