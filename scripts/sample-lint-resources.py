import json, os, pathlib, shutil, sys, time
root_pid, out = int(sys.argv[1]), pathlib.Path(sys.argv[2])
while True:
    processes = {}
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            s = dict(line.split(':', 1) for line in (p/'status').read_text().splitlines() if ':' in line)
            processes[int(p.name)] = dict(pid=int(p.name), ppid=int(s['PPid']), comm=s['Name'].strip(), rss_kib=int(s.get('VmRSS','0 kB').split()[0]), hwm_kib=int(s.get('VmHWM','0 kB').split()[0]))
        except (OSError, ValueError, KeyError):
            pass
    children = {root_pid}
    while True:
        expanded = children | {p for p,s in processes.items() if s['ppid'] in children}
        if expanded == children:
            break
        children = expanded
    selected = [s for p,s in processes.items() if p in children]
    mem = dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    row = dict(timestamp=time.time(), mem_free_kib=int(mem['MemFree'].split()[0]), mem_available_kib=int(mem['MemAvailable'].split()[0]), swap_total_kib=int(mem['SwapTotal'].split()[0]), swap_free_kib=int(mem['SwapFree'].split()[0]), disk_free_bytes=shutil.disk_usage('.').free, load=os.getloadavg(), process_tree_rss_kib=sum(s['rss_kib'] for s in selected), processes=selected)
    for name in ['memory.events','memory.current','memory.max']:
        p=pathlib.Path('/sys/fs/cgroup')/name
        if p.exists():
            row[name]=p.read_text().strip()
    line=json.dumps(row)
    with out.open('a') as f:
        f.write(line+'\n'); f.flush(); os.fsync(f.fileno())
    print('[resource] '+line, flush=True)
    time.sleep(5)
