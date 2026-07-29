/** Web app entry point and action dispatch. */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verifyToken_(req.idToken);
    return json_({ ok: true, data: dispatch_(req.action, req.args || {}, user) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function dispatch_(action, args, user) {
  switch (action) {
    case 'ping': return { pong: true, email: user.email };
    default: throw new Error('unknown action: ' + action);
  }
}
