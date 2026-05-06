-- Cache PEM directly on row for k8s-signed (offline) certs whose KMS object
-- is a placeholder (kmsCertificateId='local:<uuid>'). For KMS-signed certs
-- this column stays NULL and getById fetches from KMS as before.
ALTER TABLE `certificates` ADD `certificate_pem` text;
