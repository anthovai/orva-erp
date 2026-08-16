delete from permissions where key in ('core.worker.read', 'core.worker.manage');
drop table worker_tasks;
