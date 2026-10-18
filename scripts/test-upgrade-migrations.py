#!/usr/bin/env python3
"""Exercise Prisma deploy on both an existing database and a fresh install.

Requires Node and installed Prisma dependencies; only temporary synthetic data
is used. Existing migration history and all existing table rows must survive.
"""
from pathlib import Path
import hashlib
import os
import shutil
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'node_modules/prisma/build/index.js'
NEW = '20261018160000_academic_records'


def prisma(env, *args):
    result = subprocess.run(['node', str(CLI), *args], cwd=ROOT, env=env,
                            text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result


def tables(db):
    return [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def snapshot(db, names):
    return {name: sorted(db.execute(f'SELECT * FROM "{name}"').fetchall(), key=repr)
            for name in names}


def insert(db, table, **values):
    # Supply synthetic values for required, non-default scalar fixture fields.
    for _, name, kind, required, default, primary in db.execute(f'PRAGMA table_info("{table}")'):
        if name not in values and default is None and (required or primary):
            values[name] = '2026-10-18 10:00:00' if kind == 'DATETIME' else (
                1 if kind in ('INTEGER', 'BOOLEAN', 'REAL') else f'{table}-{name}')
    columns = ','.join(f'"{name}"' for name in values)
    db.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in values)})',
               tuple(values.values()))


with tempfile.TemporaryDirectory(prefix='danyar-upgrade-') as directory:
    temp = Path(directory)
    schema_dir = temp / 'prisma'
    schema_dir.mkdir()
    shutil.copy2(ROOT / 'prisma/schema.prisma', schema_dir / 'schema.prisma')
    shutil.copytree(ROOT / 'prisma/migrations', schema_dir / 'migrations')
    shutil.rmtree(schema_dir / 'migrations' / NEW)
    env = {**os.environ, 'DATABASE_URL': f'file:{temp / "existing.db"}',
           'PRISMA_HIDE_UPDATE_MESSAGE': '1'}
    sqlite3.connect(temp / 'existing.db').close()
    prisma(env, 'migrate', 'deploy', '--schema', str(schema_dir / 'schema.prisma'))
    db = sqlite3.connect(temp / 'existing.db')
    db.execute('PRAGMA foreign_keys=ON')
    insert(db, 'School', id='school', name='Synthetic school')
    for uid, role in [('admin', 'SUPER_ADMIN'), ('teacher', 'TEACHER'),
                      ('student', 'STUDENT'), ('vice', 'SCHOOL_VICE')]:
        insert(db, 'User', id=uid, username=uid, passwordHash='existing-hash',
               fullName=uid, role=role, schoolId=None if uid == 'admin' else 'school')
    insert(db, 'Classroom', id='class', name='Class', schoolId='school')
    insert(db, 'SubjectGroup', id='group', name='Group', classroomId='class', schoolId='school')
    insert(db, 'ClassroomEnrollment', id='enrollment', studentId='student', classroomId='class')
    insert(db, 'TeachingAssignment', id='teaching', teacherId='teacher', subjectGroupId='group')
    insert(db, 'Upload', key='attachment', name='file.txt', mime='text/plain',
           size=7, type='FILE', uploaderId='teacher', schoolId='school')
    insert(db, 'LiveSession', id='live', classroomId='class', hostId='teacher',
           title='Live', notifyGroupId='group')
    insert(db, 'LiveParticipantLog', id='presence', sessionId='live', userId='student', role='STUDENT')
    insert(db, 'Message', id='message', kind='GROUP', senderId='teacher',
           subjectGroupId='group', body='Existing message', attachmentKey='attachment')
    insert(db, 'Assignment', id='assignment', subjectGroupId='group', title='Task', createdById='teacher')
    insert(db, 'AssignmentSubmission', id='submission', assignmentId='assignment', studentId='student')
    insert(db, 'AttendanceSession', id='attendance', classroomId='class',
           dateKey='2026-10-18', title='Attendance', creatorId='teacher')
    insert(db, 'AttendanceRecord', id='record', sessionId='attendance', studentId='student')
    insert(db, 'Notification', id='notification', userId='student')
    insert(db, 'PushSubscription', id='subscription', userId='student', endpoint='https://example.invalid/push')
    insert(db, 'OtpCode', id='otp', phoneHmac='synthetic-phone-hmac')
    insert(db, 'InfraSetting', id='global')
    db.commit()
    names = [name for name in tables(db) if name != '_prisma_migrations']
    before = snapshot(db, names)
    history = db.execute('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name').fetchall()
    upload = temp / 'uploads' / 'attachment'
    upload.parent.mkdir()
    upload.write_bytes(b'fixture')
    upload_hash = hashlib.sha256(upload.read_bytes()).hexdigest()

    shutil.copytree(ROOT / 'prisma/migrations' / NEW, schema_dir / 'migrations' / NEW)
    prisma(env, 'migrate', 'deploy', '--schema', str(schema_dir / 'schema.prisma'))
    assert snapshot(db, names) == before, 'Existing data changed during upgrade'
    assert db.execute('SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name != ? ORDER BY migration_name', (NEW,)).fetchall() == history
    assert hashlib.sha256(upload.read_bytes()).hexdigest() == upload_hash
    print(f'PASS: {len(names)} existing tables and migration checksums preserved')

    insert(db, 'Lesson', id='lesson', name='Math', schoolId='school')
    insert(db, 'TeacherLesson', id='teacher-lesson', teacherId='teacher', lessonId='lesson')
    insert(db, 'StudentGrade', id='grade', studentId='student', classroomId='class',
           dateKey='2026-10-18', sessionId='attendance', title='Test', lessonId='lesson',
           score='18', creatorId='teacher')
    insert(db, 'StudentViolation', id='violation', studentId='student', classroomId='class',
           dateKey='2026-10-18', sessionId='attendance', text='Fixture', creatorId='teacher')
    insert(db, 'VicePermission', id='permission', viceId='vice', key='live', enabled=1)
    insert(db, 'ViolationType', id='violation-type', label='Fixture')
    db.commit()
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert db.execute('SELECT passwordHash FROM User WHERE id="admin"').fetchone()[0] == 'existing-hash'
    print('PASS: all six new tables support related records; integrity and foreign keys valid')

    prisma(env, 'migrate', 'deploy', '--schema', str(schema_dir / 'schema.prisma'))
    prisma(env, 'migrate', 'diff', '--from-url', env['DATABASE_URL'],
           '--to-schema-datamodel', str(schema_dir / 'schema.prisma'), '--exit-code')
    print('PASS: repeated deploy is safe; migrated database matches schema exactly')
    env['DATABASE_URL'] = f'file:{temp / "fresh.db"}'
    sqlite3.connect(temp / 'fresh.db').close()
    prisma(env, 'migrate', 'deploy', '--schema', str(schema_dir / 'schema.prisma'))
    prisma(env, 'migrate', 'diff', '--from-url', env['DATABASE_URL'],
           '--to-schema-datamodel', str(schema_dir / 'schema.prisma'), '--exit-code')
    print('PASS: fresh install matches schema exactly')
