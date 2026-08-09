plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.svspay.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.svspay.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 6
        versionName = "1.4.1"
        buildConfigField("String", "DEFAULT_WEB_URL", "\"https://gunduata.tech/api/svs-pay/\"")
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://gunduata.tech\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
