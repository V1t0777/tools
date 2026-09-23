# Pinned Realtime browser dependency

`supabase-2.57.4.min.js` is the unmodified UMD bundle from
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js.

SHA-384 integrity: `sha384-AkNSQdptcXlJ0/NBZc4qGk86cDVXcCevwoWgEKIpHOEfbvlXGLlIkimQtONt8KNf`.
The matching MIT license is in `supabase-LICENSE`.

Pictionary loads this same-origin asset asynchronously; authentication and HTTP
fallback do not depend on the bundle loading successfully. Keep the loader version,
integrity and this file in sync when updating the dependency.
