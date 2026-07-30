globalThis.STB = globalThis.STB || {};
// APPS_SCRIPT_URL is the /exec entry point of the bound script's single web
// app deployment. Publishing a new *version* of that deployment keeps this
// URL; creating a new *deployment* mints a different one and the app would
// silently keep talking to the old code. Always use
// `versions create` + `deployments update`, never `deployments create`.
STB.config = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxti1NBzV5kAf0VU4gP0LWJZWSj0K28kxLemw0uAxT60_Gc-wHleqlUXF9fk5Z6rlOJ/exec',
  GOOGLE_CLIENT_ID: '788807437641-8e5qjroej7n22it1e8m1f095817u33sr.apps.googleusercontent.com'
};
