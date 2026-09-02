plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.healthcompanion.sync"
    compileSdk = 36

    defaultConfig {
        val betaApiBaseUrl = providers.environmentVariable("HEALTH_COMPANION_BETA_API_BASE_URL").orElse("https://beta.invalid").get()
        val betaAuthSetupUrl = providers.environmentVariable("HEALTH_COMPANION_BETA_AUTH_SETUP_URL").orElse("https://beta.invalid").get()
        val betaAppLinkHost = providers.environmentVariable("HEALTH_COMPANION_BETA_APP_LINK_HOST").orElse("beta.invalid").get()
        val betaSupabaseUrl = providers.environmentVariable("HEALTH_COMPANION_BETA_SUPABASE_URL").orElse("https://beta.invalid").get()
        val betaSupabasePublishableKey = providers.environmentVariable("HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY").orElse("missing").get()
        val googleWebClientId = providers.environmentVariable("HEALTH_COMPANION_GOOGLE_WEB_CLIENT_ID").orElse("missing").get()
        applicationId = "app.healthcompanion.sync.beta"
        minSdk = 28
        targetSdk = 36
        versionCode = 6
        versionName = "0.1.0-beta.6"
        buildConfigField("String", "API_BASE_URL", "\"$betaApiBaseUrl\"")
        buildConfigField("String", "AUTH_SETUP_URL", "\"$betaAuthSetupUrl\"")
        buildConfigField("String", "APP_LINK_HOST", "\"$betaAppLinkHost\"")
        buildConfigField("String", "SUPABASE_URL", "\"$betaSupabaseUrl\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"$betaSupabasePublishableKey\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
        manifestPlaceholders["appLinkHost"] = betaAppLinkHost
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
    implementation(platform("io.github.jan-tennert.supabase:bom:3.2.6"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.ktor:ktor-client-android:3.3.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
