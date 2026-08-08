/**
 * Public identifiers of the Google Cloud project backing this deployment.
 * These are NOT secrets — they are visible to anyone using the app and are
 * safe to commit. Access to data is controlled entirely by Google sign-in
 * and by who each spreadsheet is shared with.
 *
 * See README.md → "Google Cloud setup" for how to create these values.
 */

/** OAuth 2.0 Web client ID ("…apps.googleusercontent.com"). */
export const GOOGLE_CLIENT_ID = '';

/** API key, used only by the Google file picker. */
export const GOOGLE_API_KEY = '';

/** Cloud project number — lets picked files register with the drive.file grant. */
export const GOOGLE_APP_ID = '';
