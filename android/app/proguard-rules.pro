# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- Zest Snap -------------------------------------------------------------------------------
# Capacitor discovers plugins and their @PluginMethod methods by reflection, and the WebView bridge
# calls into them by name. Keep them (and their annotations) intact under R8.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; }
-keep class app.zestsnap.** { *; }
# Plugin packages (calendar, notifications, billing) and their models/serialisers.
-keep class dev.barooni.capacitor.calendar.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.revenuecat.purchases.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
