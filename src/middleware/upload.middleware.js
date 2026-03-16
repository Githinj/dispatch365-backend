import multer from 'multer'

// All files stored in memory — uploaded directly to Supabase Storage from buffer.
// Never use disk storage (serverless-compatible).
const memory = multer.memoryStorage()

const ALLOWED_POD = ['image/jpeg', 'image/png', 'application/pdf']
const ALLOWED_DOCS = ['application/pdf']
const ALLOWED_LOGOS = ['image/jpeg', 'image/png', 'image/svg+xml']
const ALLOWED_DRIVER_DOCS = ['image/jpeg', 'image/png', 'application/pdf']

const MB = 1024 * 1024

function typeFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`))
  }
}

/** POD upload — JPG, PNG, PDF — max 10MB */
export const uploadPOD = multer({
  storage: memory,
  limits: { fileSize: 10 * MB },
  fileFilter: typeFilter(ALLOWED_POD)
}).single('pod')

/** Fleet/driver document upload — PDF only — max 10MB */
export const uploadDocument = multer({
  storage: memory,
  limits: { fileSize: 10 * MB },
  fileFilter: typeFilter(ALLOWED_DOCS)
}).single('document')

/** Agency logo upload — JPG, PNG, SVG — max 2MB */
export const uploadLogo = multer({
  storage: memory,
  limits: { fileSize: 2 * MB },
  fileFilter: typeFilter(ALLOWED_LOGOS)
}).single('logo')

/** Driver document with photo — JPG, PNG, PDF — max 10MB */
export const uploadDriverDocument = multer({
  storage: memory,
  limits: { fileSize: 10 * MB },
  fileFilter: typeFilter(ALLOWED_DRIVER_DOCS)
}).single('document')

/**
 * Fleet registration — multiple files in one request:
 * - businessCert (PDF)
 * - operatingLicense (PDF)
 * - insuranceCert (PDF)
 */
export const uploadFleetRegistrationDocs = multer({
  storage: memory,
  limits: { fileSize: 10 * MB },
  fileFilter: typeFilter(ALLOWED_DOCS)
}).fields([
  { name: 'businessCert', maxCount: 1 },
  { name: 'operatingLicense', maxCount: 1 },
  { name: 'insuranceCert', maxCount: 1 }
])
