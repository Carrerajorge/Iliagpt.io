"""Gunicorn configuration for production deployment."""
import os
import multiprocessing

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"

workers = int(os.getenv('WORKERS', multiprocessing.cpu_count() * 2 + 1))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000

timeout = 120
keepalive = 65
graceful_timeout = 30

max_requests = 1000
max_requests_jitter = 100

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

preload_app = True
reuse_port = True

def on_starting(server):
    """Called just before the master process is initialized."""
    pass

def on_exit(server):
    """Called just before exiting Gunicorn."""
    pass

def worker_int(worker):
    """Called when a worker receives SIGINT or SIGQUIT."""
    worker.log.info("Worker received INT or QUIT signal")

def worker_abort(worker):
    """Called when a worker receives SIGABRT."""
    worker.log.info("Worker received ABRT signal")

def pre_fork(server, worker):
    """Called just before a worker is forked."""
    pass

def post_fork(server, worker):
    """Called just after a worker has been forked."""
    pass

def pre_exec(server):
    """Called just before a new master process is forked."""
    pass

def child_exit(server, worker):
    """Called in the master process when a worker exits."""
    pass
