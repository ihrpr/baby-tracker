/**
 * Identifiers of the Google Cloud project backing this deployment.
 *
 * The real values are NOT stored in the repository — the deploy workflow
 * (.github/workflows/deploy.yml) injects them from GitHub Actions secrets
 * when publishing to Pages. Note they are still public in the deployed
 * page (any browser key is); keeping them out of source just stops secret
 * scanners and keeps clones clean. Access to data is controlled entirely
 * by Google sign-in, key/client restrictions, and spreadsheet sharing.
 *
 * For local development against real Google APIs, paste your own values
 * here temporarily — but never commit them. The `__…__` placeholders make
 * the app show its "not configured" screen instead of failing cryptically.
 *
 * See README.md → "Google Cloud setup" for how to create these values.
 */

/** OAuth 2.0 Web client ID ("…apps.googleusercontent.com"). */
export const GOOGLE_CLIENT_ID = '__GOOGLE_CLIENT_ID__';

/** API key, used only by the Google file picker. */
export const GOOGLE_API_KEY = '__GOOGLE_API_KEY__';

/** Cloud project number — lets picked files register with the drive.file grant. */
export const GOOGLE_APP_ID = '__GOOGLE_APP_ID__';
