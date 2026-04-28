use std::{
    io,
    process::{Child, Command},
    sync::Arc,
};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    },
};

#[cfg(windows)]
#[derive(Debug)]
struct JobHandle(HANDLE);

#[cfg(windows)]
unsafe impl Send for JobHandle {}

#[cfg(windows)]
unsafe impl Sync for JobHandle {}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[derive(Debug)]
pub struct HelperProcess {
    pid: u32,
    child: Option<Child>,
    #[cfg(windows)]
    job: Arc<JobHandle>,
}

impl HelperProcess {
    pub fn spawn(mut command: Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        #[cfg(windows)]
        let job = create_kill_on_close_job()?;

        let child = command.spawn()?;
        let pid = child.id();

        #[cfg(windows)]
        {
            unsafe {
                AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle()))
                    .map_err(windows_error)?;
            }
        }

        Ok(Self {
            pid,
            child: Some(child),
            #[cfg(windows)]
            job,
        })
    }

    pub fn try_clone_for_kill(&self) -> Self {
        Self {
            pid: self.pid,
            child: None,
            #[cfg(windows)]
            job: Arc::clone(&self.job),
        }
    }

    pub fn child_mut(&mut self) -> &mut Child {
        self.child.as_mut().expect("helper child is unavailable")
    }

    pub fn kill_tree(&mut self) -> io::Result<()> {
        #[cfg(unix)]
        {
            use nix::{
                sys::signal::{killpg, Signal},
                unistd::Pid,
            };

            let _ = killpg(Pid::from_raw(self.pid as i32), Signal::SIGTERM);
        }

        #[cfg(windows)]
        {
            unsafe {
                let _ = TerminateJobObject(self.job.0, 1);
            }
        }

        if let Some(child) = self.child.as_mut() {
            child.kill()?;
            let _ = child.wait();
        }
        Ok(())
    }
}

#[cfg(windows)]
fn create_kill_on_close_job() -> io::Result<Arc<JobHandle>> {
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()).map_err(windows_error)? };
    let handle = Arc::new(JobHandle(job));
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            handle.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(windows_error)?;
    }
    Ok(handle)
}

#[cfg(windows)]
fn windows_error(error: windows::core::Error) -> io::Error {
    io::Error::other(error)
}
