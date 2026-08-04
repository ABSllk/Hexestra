// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectMetadata,
  ProjectRegistry,
  readProjectMetadata,
  writeProjectMetadata,
} from './project-registry';

describe('folder project registry', () => {
  let root: string;
  let registry: ProjectRegistry;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-project-registry-'));
    registry = new ProjectRegistry(path.join(root, 'user-data', 'recent-projects.json'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('stores only a recent folder reference and resolves stable project metadata', () => {
    const projectPath = path.join(root, 'operator-project');
    fs.mkdirSync(projectPath);
    const metadata = createProjectMetadata(projectPath, 'example.com');
    writeProjectMetadata(projectPath, metadata);
    registry.remember(metadata, projectPath);

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: metadata.id, path: projectPath, name: 'operator-project' }),
    ]);
    expect(readProjectMetadata(projectPath)).toEqual(metadata);
    expect(fs.readFileSync(path.join(root, 'user-data', 'recent-projects.json'), 'utf8'))
      .not.toContain('example.com');
  });

  it('drops stale references and never deletes the project folder when removing a recent', () => {
    const projectPath = path.join(root, 'keep-me');
    fs.mkdirSync(projectPath);
    const metadata = createProjectMetadata(projectPath);
    writeProjectMetadata(projectPath, metadata);
    registry.remember(metadata, projectPath);
    registry.remove(metadata.id);

    expect(registry.list()).toEqual([]);
    expect(fs.existsSync(projectPath)).toBe(true);

    registry.remember(metadata, projectPath);
    fs.rmSync(path.join(projectPath, '.hexestra'), { recursive: true });
    expect(registry.list()).toEqual([]);
  });

  it('rejects malformed project metadata instead of replacing its identity', () => {
    const projectPath = path.join(root, 'broken');
    fs.mkdirSync(path.join(projectPath, '.hexestra'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, '.hexestra', 'project.json'), '{broken', 'utf8');
    expect(() => readProjectMetadata(projectPath)).toThrow('metadata is malformed');
  });

  it('migrates legacy project data into the Hexestra directory on first read', () => {
    const projectPath = path.join(root, 'legacy-project');
    const legacyPath = path.join(projectPath, '.pengent');
    fs.mkdirSync(legacyPath, { recursive: true });
    const metadata = createProjectMetadata(projectPath);
    fs.writeFileSync(path.join(legacyPath, 'project.json'), `${JSON.stringify(metadata)}\n`, 'utf8');
    fs.writeFileSync(path.join(legacyPath, 'preserved.txt'), 'legacy data', 'utf8');

    expect(readProjectMetadata(projectPath)).toEqual(metadata);
    expect(fs.existsSync(path.join(projectPath, '.pengent'))).toBe(false);
    expect(fs.readFileSync(path.join(projectPath, '.hexestra', 'preserved.txt'), 'utf8')).toBe('legacy data');
  });
});
