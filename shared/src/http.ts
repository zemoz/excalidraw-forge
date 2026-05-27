// REST envelope types. The server only sees opaque ciphertext + IV; the
// inner shape is the client's concern.

/** Base64-encoded encrypted blob with its AES-GCM IV. */
export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

/** GET /api/rooms/:roomId/scene */
export interface SceneSnapshotResponse extends EncryptedBlob {
  sceneVersion: number;
  updatedAt: number;
}

/** PUT /api/rooms/:roomId/scene */
export interface SceneSnapshotRequest extends EncryptedBlob {
  sceneVersion: number;
}

/** PUT /api/rooms/:roomId/scene — response */
export interface SceneSnapshotPutResponse {
  accepted: boolean;
  sceneVersion: number;
}

/** GET /api/rooms/:roomId/files/:fileId */
export interface FileBlobResponse extends EncryptedBlob {
  updatedAt: number;
}

/** PUT /api/rooms/:roomId/files/:fileId */
export type FileBlobRequest = EncryptedBlob;
