using System;
using System.Diagnostics;
using System.Threading;

class Leakless
{
    static void Main(string[] args)
    {
        // leakless is called by go-rod with the parent PID as the first argument.
        // It monitors the parent process and when the parent exits, it should
        // clean up child processes. This stub just monitors and exits quietly.
        if (args.Length < 1)
        {
            // No parent PID provided, just exit silently
            return;
        }

        int parentPid;
        if (!int.TryParse(args[0], out parentPid))
        {
            return;
        }

        try
        {
            Process parentProcess = Process.GetProcessById(parentPid);

            // Wait for parent to exit (or until this process is killed)
            while (!parentProcess.HasExited)
            {
                Thread.Sleep(1000);
            }
        }
        catch (ArgumentException)
        {
            // Parent process already exited or doesn't exist
        }
        catch (Exception)
        {
            // Any other error, just exit quietly
        }
    }
}
