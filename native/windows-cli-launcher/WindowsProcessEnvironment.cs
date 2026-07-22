using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class WindowsProcessEnvironment
{
    // Why: .NET Framework's Environment.SetEnvironmentVariable(name, "") deletes the
    // variable, so re-adding a collision winner with an empty value needs the Win32 setter.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetEnvironmentVariable(string name, string value);

    internal static void NormalizeCaseCollisions()
    {
        Dictionary<string, List<EnvironmentEntry>> groups =
            new Dictionary<string, List<EnvironmentEntry>>(StringComparer.OrdinalIgnoreCase);
        // Why: the case-sensitive Hashtable exposes both spellings of a case-only duplicate,
        // unlike the case-insensitive StringDictionary the child process would reject.
        foreach (DictionaryEntry variable in Environment.GetEnvironmentVariables())
        {
            EnvironmentEntry entry = new EnvironmentEntry((string)variable.Key, (string)variable.Value);
            List<EnvironmentEntry> group;
            if (!groups.TryGetValue(entry.Name, out group))
            {
                group = new List<EnvironmentEntry>();
                groups.Add(entry.Name, group);
            }
            group.Add(entry);
        }

        foreach (List<EnvironmentEntry> group in groups.Values)
        {
            // Why: leading-'=' drive-cursor pseudo-vars are Windows-internal; only real
            // case-only duplicates trip the child's case-insensitive environment.
            if (group.Count < 2 || group[0].Name[0] == '=')
            {
                continue;
            }
            NormalizeGroup(group);
        }
    }

    private static void NormalizeGroup(List<EnvironmentEntry> group)
    {
        EnvironmentEntry winner = SelectWinner(group);
        // Why: Win32 drops one case-insensitive node per delete, so one call per collided
        // node clears them all; deleting an already-absent name still succeeds.
        foreach (EnvironmentEntry entry in group)
        {
            SetEntry(entry.Name, null);
        }
        if (Environment.GetEnvironmentVariable(winner.Name) != null)
        {
            throw new InvalidOperationException(
                "Unable to remove a case-insensitive environment collision for " + winner.Name
            );
        }
        SetEntry(winner.Name, winner.Value);
    }

    private static EnvironmentEntry SelectWinner(List<EnvironmentEntry> group)
    {
        if (String.Equals(group[0].Name, "PATH", StringComparison.OrdinalIgnoreCase))
        {
            foreach (EnvironmentEntry entry in group)
            {
                // Why: canonical Windows Path is directly executable; merging Linux PATH text
                // would change lookup order and turn path normalization into an injection vector.
                if (entry.Name == "Path")
                {
                    return entry;
                }
            }
        }

        // Why: unrelated collisions have no correct merge, so keep the ordinally-first spelling;
        // that is deterministic regardless of the environment's enumeration order.
        EnvironmentEntry winner = group[0];
        foreach (EnvironmentEntry entry in group)
        {
            if (String.CompareOrdinal(entry.Name, winner.Name) < 0)
            {
                winner = entry;
            }
        }
        return winner;
    }

    private static void SetEntry(string name, string value)
    {
        if (!SetEnvironmentVariable(name, value))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    private sealed class EnvironmentEntry
    {
        internal EnvironmentEntry(string name, string value)
        {
            Name = name;
            Value = value;
        }

        internal string Name { get; private set; }
        internal string Value { get; private set; }
    }
}
