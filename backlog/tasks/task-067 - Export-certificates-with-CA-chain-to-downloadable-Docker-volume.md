---
id: task-067
title: Export certificates with CA chain to downloadable Docker volume
status: To Do
assignee: []
created_date: '2025-11-27 12:01'
labels:
  - frontend
  - backend
  - feature
  - docker
  - certificates
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add functionality to export one or multiple certificates along with their corresponding CA certificates into a Docker volume file (.tar) that can be downloaded. The feature should include:

1. Selection interface to choose certificates to export
2. Automatic inclusion of the CA chain for each selected certificate
3. Progress popup showing the export/packaging process
4. Download of the Docker volume tar file
5. Post-download popup with instructions on how to import the volume into Docker (e.g., `docker run --rm -v target_volume:/data -v $(pwd):/backup busybox tar xvf /backup/certificates.tar -C /data`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can select one or multiple certificates to export
- [ ] #2 Exported package includes the full CA chain for each certificate
- [ ] #3 Progress popup displays real-time export status
- [ ] #4 User receives a downloadable .tar file compatible with Docker volumes
- [ ] #5 Post-download popup shows Docker volume import instructions with copy-to-clipboard command
<!-- AC:END -->
