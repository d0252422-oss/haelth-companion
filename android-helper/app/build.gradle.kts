plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.healthcompanion.sync"
    compileSdk = 36

    defaultConfig {
        val betaApiBaseUrl = providers.environmentVariable("HEALTH_COMPANION_BETA_API_BASE_URL").orElse("https://beta.invalid").get()
        val betaAppLinkHost = providers.environmentVariable("HEALTH_COMPANION_BETA_APP_LINK_HOST").orElse("beta.invalid").get()
        applicationId = "app.healthcompanion.sync.beta"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-beta.1"
        buildConfigField("String", "API_BASE_URL", "\"$betaApiBaseUrl\"")
        buildConfigField("String", "APP_LINK_HOST", "\"$betaAppLinkHost\"")
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
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
}
