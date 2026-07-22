using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class OrcaCliEnvironmentBlockHarness
{
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const int StartfUseStdHandles = 0x00000100;
    private const uint Infinite = 0xffffffff;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        internal int Size;
        internal string Reserved;
        internal string Desktop;
        internal string Title;
        internal int X;
        internal int Y;
        internal int XSize;
        internal int YSize;
        internal int XCountChars;
        internal int YCountChars;
        internal int FillAttribute;
        internal int Flags;
        internal short ShowWindow;
        internal short ReservedByteCount;
        internal IntPtr ReservedBytes;
        internal IntPtr StandardInput;
        internal IntPtr StandardOutput;
        internal IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        internal IntPtr Process;
        internal IntPtr Thread;
        internal int ProcessId;
        internal int ThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation
    );

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: harness <launcher> <environment-case> [args]");
            return 2;
        }

        List<string> environment = ReadEnvironment();
        ConfigureEnvironment(environment, args[1]);
        environment.Sort(CompareEnvironmentEntries);
        string environmentBlock = String.Join("\0", environment.ToArray()) + "\0\0";
        GCHandle pinnedEnvironment = GCHandle.Alloc(
            Encoding.Unicode.GetBytes(environmentBlock),
            GCHandleType.Pinned
        );
        ProcessInformation child = new ProcessInformation();

        try
        {
            StartupInfo startup = new StartupInfo();
            startup.Size = Marshal.SizeOf(typeof(StartupInfo));
            startup.Flags = StartfUseStdHandles;
            startup.StandardInput = GetStdHandle(-10);
            startup.StandardOutput = GetStdHandle(-11);
            startup.StandardError = GetStdHandle(-12);
            StringBuilder commandLine = BuildCommandLine(args);
            if (!CreateProcess(
                    args[0],
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateUnicodeEnvironment,
                    pinnedEnvironment.AddrOfPinnedObject(),
                    Path.GetDirectoryName(args[0]),
                    ref startup,
                    out child
                ))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            WaitForSingleObject(child.Process, Infinite);
            int exitCode;
            if (!GetExitCodeProcess(child.Process, out exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            return exitCode;
        }
        finally
        {
            if (child.Thread != IntPtr.Zero)
            {
                CloseHandle(child.Thread);
            }
            if (child.Process != IntPtr.Zero)
            {
                CloseHandle(child.Process);
            }
            pinnedEnvironment.Free();
        }
    }

    private static List<string> ReadEnvironment()
    {
        List<string> result = new List<string>();
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            result.Add((string)entry.Key + "=" + (string)entry.Value);
        }
        return result;
    }

    private static void ConfigureEnvironment(List<string> environment, string environmentCase)
    {
        SetEntry(environment, "ORCA_CLI_CWD", "C:\\WSL Folder\\한글");
        if (environmentCase == "path-pair")
        {
            RemoveEntries(environment, "PATH");
            environment.Add("PATH=C:\\wsl-bin;C:\\shared-bin");
            environment.Add("Path=C:\\Windows\\System32;C:\\Windows");
        }
        else if (environmentCase == "general-pair")
        {
            RemoveEntries(environment, "ORCA_CASE_TEST");
            environment.Add("ORCA_CASE_TEST=first");
            environment.Add("orca_case_test=second");
        }
        else if (environmentCase == "empty-pair")
        {
            RemoveEntries(environment, "ORCA_EMPTY_TEST");
            environment.Add("ORCA_EMPTY_TEST=");
            environment.Add("orca_empty_test=nonempty");
        }
        else if (environmentCase == "only-PATH" || environmentCase == "only-Path")
        {
            RemoveEntries(environment, "PATH");
            environment.Add(environmentCase.Substring(5) + "=C:\\single-bin");
        }
        else if (environmentCase == "unicode-control")
        {
            SetEntry(environment, "ORCA_UNICODE_TEST", "한글 value with spaces and \"quotes\"");
        }
        else
        {
            throw new ArgumentException("Unknown environment case: " + environmentCase);
        }
    }

    private static void SetEntry(List<string> environment, string name, string value)
    {
        RemoveEntries(environment, name);
        environment.Add(name + "=" + value);
    }

    private static void RemoveEntries(List<string> environment, string name)
    {
        environment.RemoveAll(delegate(string entry)
        {
            return String.Equals(GetEntryName(entry), name, StringComparison.OrdinalIgnoreCase);
        });
    }

    private static int CompareEnvironmentEntries(string left, string right)
    {
        int folded = StringComparer.OrdinalIgnoreCase.Compare(GetEntryName(left), GetEntryName(right));
        return folded != 0 ? folded : StringComparer.Ordinal.Compare(GetEntryName(left), GetEntryName(right));
    }

    private static string GetEntryName(string entry)
    {
        int separator = entry[0] == '=' ? entry.IndexOf('=', 1) : entry.IndexOf('=');
        return entry.Substring(0, separator);
    }

    private static StringBuilder BuildCommandLine(string[] args)
    {
        StringBuilder commandLine = new StringBuilder(QuoteArgument(args[0]));
        for (int index = 2; index < args.Length; index += 1)
        {
            commandLine.Append(' ');
            commandLine.Append(QuoteArgument(args[index]));
        }
        return commandLine;
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
