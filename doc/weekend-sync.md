# Weekend Sync

Use git for the toolkit code and helper scripts. Do not commit the live
Overleaf instance state under `config/` or `data/`: those directories contain
local configuration, secrets, MongoDB/Redis files, uploads, caches, and files
that Docker may own as `root`.

For a full instance transfer between machines, use stopped-container backups.

## Create a Backup

From the original machine:

```sh
cd ~/Documents/overleaf-toolkit
sudo bin/backup-instance
```

The command stops the Overleaf services, then creates an archive in
`~/Documents/overleaf-backups/` by default. Keep the archive private.

If the services are already stopped and you do not want the script to call
Docker, use:

```sh
sudo bin/backup-instance --skip-stop
```

## Restore on Another Machine

Clone the toolkit, put the backup archive somewhere outside the repository, and
restore it:

```sh
git clone https://github.com/overleaf/toolkit.git ~/Documents/overleaf-toolkit
cd ~/Documents/overleaf-toolkit
sudo bin/restore-instance ~/Documents/overleaf-backups/overleaf-instance-YYYYMMDD-HHMMSS.tar.gz
bin/up -d
```

If the target machine already has local Overleaf state, the restore command
refuses to overwrite it. To replace that state, use `--replace`; the script will
make a safety backup before replacing `config/` and `data/`.

```sh
sudo bin/restore-instance --replace ~/Documents/overleaf-backups/overleaf-instance-YYYYMMDD-HHMMSS.tar.gz
```

After restoring, open Overleaf and check that you can log in, see the project,
and compile the report. `bin/doctor` is useful if the restored instance does not
start cleanly.

## Report-Only Alternative

If you only need weekend editing, a separate git repository for the LaTeX report
source is smaller and easier to merge. Use the full instance backup only when you
need the local Overleaf users, database, project history, and uploaded files to
move together.
