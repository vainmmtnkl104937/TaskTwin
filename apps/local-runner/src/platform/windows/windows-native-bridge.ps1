$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;

public static class TaskTwinCngDpapi {
    private const uint NCRYPT_SILENT_FLAG = 0x00000040;

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptCreateProtectionDescriptor(
        string descriptor, uint flags, out IntPtr handle);

    [DllImport("ncrypt.dll")]
    private static extern int NCryptCloseProtectionDescriptor(IntPtr handle);

    [DllImport("ncrypt.dll")]
    private static extern int NCryptProtectSecret(
        IntPtr descriptor, uint flags, byte[] data, uint dataLength,
        IntPtr memoryParameters, IntPtr window, out IntPtr output, out uint outputLength);

    [DllImport("ncrypt.dll")]
    private static extern int NCryptUnprotectSecret(
        out IntPtr descriptor, uint flags, byte[] protectedBlob, uint protectedBlobLength,
        IntPtr memoryParameters, IntPtr window, out IntPtr output, out uint outputLength);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static byte[] Protect(byte[] data, string descriptorText) {
        IntPtr descriptor = IntPtr.Zero;
        IntPtr output = IntPtr.Zero;
        try {
            int status = NCryptCreateProtectionDescriptor(descriptorText, 0, out descriptor);
            if (status != 0) throw new InvalidOperationException("native_failure");
            uint outputLength;
            status = NCryptProtectSecret(descriptor, NCRYPT_SILENT_FLAG, data,
                (uint)data.Length, IntPtr.Zero, IntPtr.Zero, out output, out outputLength);
            if (status != 0 || output == IntPtr.Zero) throw new InvalidOperationException("native_failure");
            byte[] result = new byte[outputLength];
            Marshal.Copy(output, result, 0, (int)outputLength);
            return result;
        } finally {
            if (output != IntPtr.Zero) LocalFree(output);
            if (descriptor != IntPtr.Zero) NCryptCloseProtectionDescriptor(descriptor);
        }
    }

    public static byte[] Unprotect(byte[] data) {
        IntPtr descriptor = IntPtr.Zero;
        IntPtr output = IntPtr.Zero;
        try {
            uint outputLength;
            int status = NCryptUnprotectSecret(out descriptor, NCRYPT_SILENT_FLAG, data,
                (uint)data.Length, IntPtr.Zero, IntPtr.Zero, out output, out outputLength);
            if (status != 0 || output == IntPtr.Zero) throw new InvalidOperationException("native_failure");
            byte[] result = new byte[outputLength];
            Marshal.Copy(output, result, 0, (int)outputLength);
            return result;
        } finally {
            if (output != IntPtr.Zero) LocalFree(output);
            if (descriptor != IntPtr.Zero) NCryptCloseProtectionDescriptor(descriptor);
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp
    $requestText = [Console]::In.ReadToEnd()
    $request = $requestText | ConvertFrom-Json
    $inputBytes = [Convert]::FromBase64String([string]$request.data)
    $result = $null
    try {
        if ([string]$request.operation -eq 'protect') {
            if ([string]::IsNullOrWhiteSpace([string]$request.descriptor)) { throw 'invalid' }
            $result = [TaskTwinCngDpapi]::Protect($inputBytes, [string]$request.descriptor)
        } elseif ([string]$request.operation -eq 'unprotect') {
            $result = [TaskTwinCngDpapi]::Unprotect($inputBytes)
        } else {
            throw 'invalid'
        }
        [Console]::Out.Write((@{ ok = $true; data = [Convert]::ToBase64String($result) } | ConvertTo-Json -Compress))
    } finally {
        if ($null -ne $inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
        if ($null -ne $result) { [Array]::Clear($result, 0, $result.Length) }
    }
} catch {
    [Console]::Out.Write('{"ok":false,"code":"NATIVE_PROTECTOR_FAILED"}')
    exit 1
}
