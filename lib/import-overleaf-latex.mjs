import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import Path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { Project } from '/overleaf/services/web/app/src/models/Project.mjs'
import DocumentUpdaterHandler from '/overleaf/services/web/app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import FileSystemImportManager from '/overleaf/services/web/app/src/Features/Uploads/FileSystemImportManager.mjs'
import ProjectEntityHandler from '/overleaf/services/web/app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectEntityUpdateHandler from '/overleaf/services/web/app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import ProjectRootDocManager from '/overleaf/services/web/app/src/Features/Project/ProjectRootDocManager.mjs'
import ProjectZipStreamManager from '/overleaf/services/web/app/src/Features/Downloads/ProjectZipStreamManager.mjs'
import { gracefulShutdown } from '/overleaf/services/web/app/src/infrastructure/GracefulShutdown.mjs'

const createZipStreamForProject = promisify(
  ProjectZipStreamManager.createZipStreamForProject
).bind(ProjectZipStreamManager)

function parseArgs(argv) {
  const args = {
    deleteMissing: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--source':
        args.source = argv[++i]
        break
      case '--project-name':
        args.projectName = argv[++i]
        break
      case '--project-id':
        args.projectId = argv[++i]
        break
      case '--backup':
        args.backup = argv[++i]
        break
      case '--delete-missing':
        args.deleteMissing = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!args.source) throw new Error('--source is required')
  if (!args.projectId && !args.projectName) {
    throw new Error('--project-id or --project-name is required')
  }
  if (!args.dryRun && !args.backup) throw new Error('--backup is required')
  return args
}

async function findProject({ projectId, projectName }) {
  if (projectId) {
    const project = await Project.findById(projectId).exec()
    if (!project) throw new Error(`Project not found by id: ${projectId}`)
    return project
  }

  const projects = await Project.find({ name: projectName }).exec()
  if (projects.length === 0) {
    throw new Error(`Project not found by name: ${projectName}`)
  }
  if (projects.length > 1) {
    const ids = projects.map(project => project._id.toString()).join(', ')
    throw new Error(
      `Multiple projects named ${projectName}; rerun with --project-id. Matches: ${ids}`
    )
  }
  return projects[0]
}

function normalizeProjectPath(projectPath) {
  return projectPath.startsWith('/') ? projectPath : `/${projectPath}`
}

async function listDesiredEntries(source) {
  const imports = await FileSystemImportManager.promises.importDir(source)
  return imports
    .map(entry => ({
      ...entry,
      projectPath: normalizeProjectPath(entry.projectPath),
    }))
    .sort((a, b) => a.projectPath.localeCompare(b.projectPath))
}

async function exportProject(projectId, outputPath) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const zipStream = await createZipStreamForProject(projectId)
  await pipeline(zipStream, createWriteStream(outputPath, { flags: 'wx' }))
}

async function listCurrentPaths(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])
  return {
    docs: Object.keys(docs).sort(),
    files: Object.keys(files).sort(),
  }
}

async function upsertEntries(project, desiredEntries) {
  const projectId = project._id
  const userId = project.owner_ref
  let docsAdded = 0
  let docsUpdated = 0
  let filesAdded = 0
  let filesUpdated = 0

  for (const entry of desiredEntries) {
    if (entry.type === 'doc') {
      const { isNew } =
        await ProjectEntityUpdateHandler.promises.upsertDocWithPath(
          projectId,
          entry.projectPath,
          entry.lines,
          'git-import',
          userId
        )
      if (isNew) docsAdded++
      else docsUpdated++
    } else if (entry.type === 'file') {
      const { isNew } =
        await ProjectEntityUpdateHandler.promises.upsertFileWithPath(
          projectId,
          entry.projectPath,
          entry.fsPath,
          null,
          userId,
          'git-import'
        )
      if (isNew) filesAdded++
      else filesUpdated++
    } else {
      throw new Error(`Unsupported import entry type: ${entry.type}`)
    }
  }

  return { docsAdded, docsUpdated, filesAdded, filesUpdated }
}

async function deleteMissingEntries(project, desiredPaths) {
  const projectId = project._id
  const userId = project.owner_ref
  const { docs, files } = await listCurrentPaths(projectId)
  const stalePaths = [...docs, ...files]
    .filter(projectPath => !desiredPaths.has(projectPath))
    .sort((a, b) => b.length - a.length)

  for (const stalePath of stalePaths) {
    await ProjectEntityUpdateHandler.promises.deleteEntityWithPath(
      projectId,
      stalePath,
      userId,
      'git-import'
    )
  }

  const refreshedProject = await Project.findById(projectId, {
    rootFolder: true,
  }).exec()
  const entities = ProjectEntityHandler.getAllEntitiesFromProject(refreshedProject)
  const desiredFolders = new Set(['/'])
  for (const desiredPath of desiredPaths) {
    let folder = Path.posix.dirname(desiredPath)
    while (folder && folder !== '.') {
      desiredFolders.add(folder)
      if (folder === '/') break
      folder = Path.posix.dirname(folder)
    }
  }

  const staleFolders = entities.folders
    .map(entry => entry.path)
    .filter(folderPath => folderPath !== '/' && !desiredFolders.has(folderPath))
    .sort((a, b) => b.length - a.length)

  for (const staleFolder of staleFolders) {
    await ProjectEntityUpdateHandler.promises.deleteEntityWithPath(
      projectId,
      staleFolder,
      userId,
      'git-import'
    )
  }

  return { stalePaths, staleFolders }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sourceStat = await fs.stat(args.source)
  if (!sourceStat.isDirectory()) {
    throw new Error(`Source is not a directory: ${args.source}`)
  }

  const project = await findProject(args)
  const desiredEntries = await listDesiredEntries(args.source)
  const desiredPaths = new Set(desiredEntries.map(entry => entry.projectPath))
  const currentPaths = await listCurrentPaths(project._id)
  const stalePreview = [...currentPaths.docs, ...currentPaths.files].filter(
    projectPath => !desiredPaths.has(projectPath)
  )

  console.log(`Project: ${project.name} (${project._id})`)
  console.log(`Source: ${args.source}`)
  console.log(`Git entries: ${desiredEntries.length}`)
  for (const entry of desiredEntries) {
    console.log(`  ${entry.type.padEnd(4)} ${entry.projectPath}`)
  }

  if (args.deleteMissing && stalePreview.length > 0) {
    console.log('Will delete paths absent from Git:')
    for (const stalePath of stalePreview.sort()) {
      console.log(`  ${stalePath}`)
    }
  }

  if (args.dryRun) {
    console.log('Dry run only; no Overleaf changes made.')
    return
  }

  console.log(`Saving pre-import backup: ${args.backup}`)
  await exportProject(project._id, args.backup)

  const importStats = await upsertEntries(project, desiredEntries)
  let deleteStats = { stalePaths: [], staleFolders: [] }
  if (args.deleteMissing) {
    deleteStats = await deleteMissingEntries(project, desiredPaths)
  }

  await ProjectRootDocManager.promises.setRootDocFromName(
    project._id,
    '/main.tex'
  )
  await DocumentUpdaterHandler.promises.flushProjectToMongo(project._id)

  console.log('Import complete.')
  console.log(
    `Docs added/updated: ${importStats.docsAdded}/${importStats.docsUpdated}`
  )
  console.log(
    `Files added/updated: ${importStats.filesAdded}/${importStats.filesUpdated}`
  )
  console.log(`Deleted stale paths: ${deleteStats.stalePaths.length}`)
  console.log(`Deleted stale folders: ${deleteStats.staleFolders.length}`)
}

main()
  .catch(error => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await gracefulShutdown({ close: done => done() })
  })
