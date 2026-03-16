import { supabase } from './supabase.service.js'
import { v4 as uuid } from 'uuid'

export const storageService = {

  /**
   * Upload POD file (proof of delivery).
   * Bucket: pod-files (private)
   * Returns: permanent storage path (saved to DB) — use getSignedUrl() to serve
   */
  async uploadPOD(file, loadId) {
    const ext = file.originalname.split('.').pop()
    const path = `loads/${loadId}/pod-${uuid()}.${ext}`
    return this._upload(process.env.STORAGE_BUCKET_POD, path, file)
  },

  /**
   * Upload fleet registration document (business reg, license, insurance).
   * Bucket: fleet-documents (private)
   */
  async uploadFleetDocument(file, fleetId, documentType) {
    const ext = file.originalname.split('.').pop()
    const path = `${fleetId}/${documentType}-${uuid()}.${ext}`
    return this._upload(process.env.STORAGE_BUCKET_DOCUMENTS, path, file)
  },

  /**
   * Upload driver document (license copy, medical cert, etc.).
   * Bucket: driver-documents (private)
   */
  async uploadDriverDocument(file, driverId, documentType) {
    const ext = file.originalname.split('.').pop()
    const path = `${driverId}/${documentType}-${uuid()}.${ext}`
    return this._upload(process.env.STORAGE_BUCKET_DRIVER_DOCS, path, file)
  },

  /**
   * Upload agency logo.
   * Bucket: agency-logos (PUBLIC — URL usable directly in emails/PDFs)
   */
  async uploadAgencyLogo(file, agencyId) {
    const ext = file.originalname.split('.').pop()
    const path = `${agencyId}/logo-${uuid()}.${ext}`
    return this._upload(process.env.STORAGE_BUCKET_LOGOS, path, file)
  },

  /**
   * Upload a generated invoice or receipt PDF.
   * Bucket: invoice-pdfs (private)
   * @param {Buffer} pdfBuffer - PDF buffer from Puppeteer/React PDF
   * @param {string} filename  - e.g. "INV-2026-0001.pdf"
   * @param {string} subfolder - "invoices" or "receipts"
   * Returns: permanent storage path
   */
  async uploadPDF(pdfBuffer, filename, subfolder) {
    const path = `${subfolder}/${filename}`
    const { error } = await supabase.storage
      .from(process.env.STORAGE_BUCKET_PDFS)
      .upload(path, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      })
    if (error) throw new Error(`PDF upload failed: ${error.message}`)
    return path // return path, not public URL — private bucket requires signed URLs
  },

  /**
   * Generate a signed URL for a private bucket file.
   * Valid for 1 hour (3600 seconds).
   * Use for: POD files, fleet documents, driver documents, invoice PDFs
   */
  async getSignedUrl(bucket, path, expiresInSeconds = 3600) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds)
    if (error) throw new Error(`Failed to generate signed URL: ${error.message}`)
    return data.signedUrl
  },

  /**
   * Get public URL for a public bucket file.
   * Use for: agency logos (agency-logos bucket is public)
   */
  getPublicUrl(bucket, path) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  /**
   * Delete a file from storage.
   */
  async deleteFile(bucket, path) {
    const { error } = await supabase.storage.from(bucket).remove([path])
    if (error) console.error(`Storage delete failed [${bucket}/${path}]:`, error.message)
  },

  /**
   * Internal upload helper.
   * Receives file from multer memoryStorage (req.file).
   * Returns storage path for private buckets.
   */
  async _upload(bucket, path, file) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)
    return path // return path — caller decides if they need signed URL or public URL
  }
}
