using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string node = Path.Combine(dir, "node-runtime", "node.exe");
        string script = Path.Combine(dir, "scripts", "start-app.mjs");
        string dataDir = Path.Combine(dir, "data");

        if (!File.Exists(node) || !File.Exists(script))
        {
            MessageBox.Show(
                "Missing runtime files:\n" + node + "\n" + script +
                "\n\nPlease make sure the folder is complete (node-runtime and scripts must both be present).",
                "Muzi Workspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "\"" + script + "\"",
                WorkingDirectory = dir,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.EnvironmentVariables["MUZI_DATA_DIR"] = dataDir;

            var p = Process.Start(psi);
            p.WaitForExit();

            if (p.ExitCode != 0)
            {
                MessageBox.Show(
                    "Failed to start Muzi Workspace. See the log:\n" +
                    Path.Combine(dataDir, "logs", "app.log"),
                    "Muzi Workspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Startup failed: " + ex.Message, "Muzi Workspace",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
