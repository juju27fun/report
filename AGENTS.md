# Agent Context

This repository is a personal Overleaf Toolkit checkout used to move one report
between machines. Keep the official toolkit remote separate from the personal
report remote.

## Remotes

- `origin` is the personal GitHub repository for this workflow:
  `git@github.com:juju27fun/report.git`.
- Do not push `config/`, `data/`, live runtime state, or unrelated toolkit
  changes to `origin`.

## Data Boundaries

- Do not commit `config/`, `data/`, live database files, Docker state, or backup
  archives. Those are local runtime state and may contain secrets.
- The Git-tracked LaTeX source is `latex/test_internship_3A/`.
- The browser-visible Overleaf project is stored in the local Overleaf instance,
  not directly in `latex/test_internship_3A/`.

## Daily Sync Workflow

When pulling report changes from Git into this machine:

```sh
cd ~/Documents/overleaf-toolkit
git pull
bin/import-overleaf-latex
```

`bin/import-overleaf-latex` replaces the local Overleaf project
`test_internship_3A` from `latex/test_internship_3A/`, deletes paths absent from
Git, and saves a pre-import backup under
`~/Documents/overleaf-import-backups/`.

When exporting Overleaf edits back to Git, use the local export/push workflow if
available on that machine, then commit only `latex/test_internship_3A/` changes.
Do not edit `data/overleaf/data/compiles/...` as a synchronization shortcut; it
is only compile/cache state.

If the user says "envoie mes modifs Overleaf", "push Overleaf", or "sync mon
latex", run:

```sh
cd ~/Documents/overleaf-toolkit
bin/push-overleaf-latex
```

This exports the local Overleaf project `test_internship_3A` to
`latex/test_internship_3A/`, commits only that path, and pushes the current
branch. If the user asks only to inspect or dry-run the workflow, use
`bin/push-overleaf-latex --dry-run`.

## Full Instance Transfer

Use stopped-container backups for full Overleaf instance moves:

```sh
sudo bin/backup-instance
sudo bin/restore-instance /path/to/overleaf-instance-YYYYMMDD-HHMMSS.tar.gz
```

See `doc/weekend-sync.md` for the longer protocol.
