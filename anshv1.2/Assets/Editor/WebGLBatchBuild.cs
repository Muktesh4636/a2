using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class WebGLBatchBuild
{
    public static void BuildWebGL()
    {
        const string scene = "Assets/Scenes/MainGame.unity";
        string outDir = Path.Combine(Directory.GetCurrentDirectory(), "Builds", "WebGL");
        Directory.CreateDirectory(outDir);

        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { scene },
            locationPathName = outDir,
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        });

        Debug.Log("[WebGLBatchBuild] result=" + report.summary.result
                  + " errors=" + report.summary.totalErrors
                  + " out=" + outDir);

        EditorApplication.Exit(report.summary.result == BuildResult.Succeeded ? 0 : 1);
    }
}
