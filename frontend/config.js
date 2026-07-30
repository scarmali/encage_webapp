// enCAGE frontend config
// Point this at your deployed backend, no trailing slash.
//
// Production: api.encage.app is a CNAME to the Render service, so the backend
// can be moved later by changing DNS rather than shipping a code change.
//
// Local testing: serve this folder over http:// (not the live domain) and use
// "http://localhost:5000". Note that encage.app is HSTS-preloaded, so a page
// loaded from the real domain can never call an http:// backend.
window.ENCAGE_API_BASE = "https://api.encage.app";
