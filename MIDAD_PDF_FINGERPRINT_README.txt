IN THE VOID — PDF Forensic Fingerprinting
=========================================

This add-on fingerprints PDF downloads without changing the visible filename, page content, or layout.

Behavior
--------
1) A user who downloads the clean/original PDF gets a new fingerprint containing the user name, role, date, day and time.
2) If an administrator manually re-uploads a previously fingerprinted copy, the download process reads the embedded parent fingerprints and preserves them, then appends the current downloader fingerprint.
3) Direct downloads of the clean/original file do NOT inherit another user's fingerprint.
4) The visible PDF does not display a "fingerprint" label or the site name.
5) The fingerprint marker is repeated on every page as tiny/off-page content. The final PDF SHA-256 is also stored server-side.
6) The server-side record stores the fingerprint, user, role, material, date, day, time, parent fingerprints and final SHA-256.

Important security limitation
-----------------------------
A PDF that is completely rebuilt from scratch can discard any embedded digital marker. The scanner should treat a missing/invalid marker or hash as a tampered/untrusted copy rather than claiming it is the original. No embedded mechanism can force an external program to preserve data while creating a brand-new PDF.

Supabase
--------
Run MIDAD_PDF_FINGERPRINT.sql once in the project SQL editor. It only creates/updates the fingerprint add-on objects and does not delete application tables.

Scanner name
------------
In The Void
PDF Forensic Scanner
